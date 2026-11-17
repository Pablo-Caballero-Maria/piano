"""The classroom board, as the teacher's PC sees it over MQTT.

Topics (``<id>`` = PIANO_BOARD_ID), see esp32/app.py for the board's side:

==============================  ===========  ==============================================
``piano/<id>/tone``             PC → board   frequency to play (2 bytes, little-endian Hz)
``piano/<id>/chirp``            PC → board   a short signal ("online"…)
``piano/<id>/kv/req``           PC → board   storage request (binary, esp32/kv.py)
``piano/<id>/kv/res``           board → PC   storage answer
``piano/<id>/ota``              PC → board   {"sha", "url"}: update to that version
``piano/<id>/status``           board → PC   {"online", "sha", "free", …} (retained; last will)
``piano/<id>/log``              board → PC   update results and other news
==============================  ===========  ==============================================

:class:`BoardLink` is transport-agnostic: :meth:`run` connects it to the broker with aiomqtt, and
tests plug it straight into the board's own code instead.
"""

from __future__ import annotations

import asyncio
import json
import logging
import struct
from collections.abc import Awaitable, Callable
from typing import Any

from pianocore.service import ServiceError

log = logging.getLogger(__name__)

GET, PUT, DEL, KEYS, MANY, INFO = 1, 2, 3, 4, 5, 6
OK, MISSING, ERROR = 0, 1, 2
TIMEOUT_S = 4.0
RETRIES = 2
MANY_BATCH = 64

Publish = Callable[[str, bytes, bool], Awaitable[None]]


class BoardOffline(ServiceError):
    def __init__(self, message: str = "The classroom board is offline") -> None:
        super().__init__(503, message)


class BoardLink:
    def __init__(self, board_id: str) -> None:
        self.board_id = board_id
        self.status: dict[str, Any] = {"online": False}
        self.log_lines: list[str] = []
        self._publish: Publish | None = None
        self._rid = 0
        self._pending: dict[int, asyncio.Future[bytes]] = {}
        self._lock = asyncio.Lock()  # one storage request at a time: the board answers in order
        self.listeners: list[Callable[[dict[str, Any]], Awaitable[None] | None]] = []

    def topic(self, name: str) -> str:
        return f"piano/{self.board_id}/{name}"

    @property
    def online(self) -> bool:
        return self._publish is not None and bool(self.status.get("online"))

    # ---- Incoming
    async def handle_message(self, topic: str, payload: bytes) -> None:
        name = topic.removeprefix(self.topic(""))
        if name == "kv/res" and len(payload) >= 3:
            rid = struct.unpack("!H", payload[:2])[0]
            fut = self._pending.pop(rid, None)
            if fut and not fut.done():
                fut.set_result(payload[2:])
        elif name == "status":
            try:
                self.status = json.loads(payload) if payload else {"online": False}
            except ValueError:
                self.status = {"online": False}
            log.info("Board %s: %s", self.board_id, "online" if self.status.get("online") else "offline")
            for fn in self.listeners:
                result = fn(self.status)
                if result is not None:
                    await result
        elif name == "log":
            line = payload.decode(errors="replace")
            log.info("Board %s says: %s", self.board_id, line)
            self.log_lines = [*self.log_lines[-19:], line]

    def attach(self, publish: Publish | None) -> None:
        """Start (or stop, with None) sending through ``publish(topic, payload, retain)``."""
        self._publish = publish
        if publish is None:
            for fut in self._pending.values():
                if not fut.done():
                    fut.set_exception(BoardOffline("Lost the connection to the MQTT broker"))
            self._pending.clear()

    # ---- Buzzer and updates (fire and forget)
    async def _send(self, name: str, payload: bytes, retain: bool = False) -> bool:
        if self._publish is None:
            return False
        try:
            await self._publish(self.topic(name), payload, retain)
            return True
        except Exception as e:
            log.warning("MQTT publish failed: %r", e)
            return False

    async def tone(self, freq: int) -> None:
        await self._send("tone", struct.pack("<H", max(0, min(65535, int(freq)))))

    async def chirp(self, name: str) -> None:
        await self._send("chirp", name.encode())

    async def ota(self, sha: str, url: str) -> bool:
        return await self._send("ota", json.dumps({"sha": sha, "url": url}).encode())

    # ---- Storage (pianocore.kv_repo.KV)
    async def _call(self, op: int, arg: bytes) -> tuple[int, bytes]:
        if not self.online:
            raise BoardOffline()
        async with self._lock:
            for attempt in range(RETRIES + 1):
                self._rid = self._rid % 0xFFFF + 1
                rid = self._rid
                fut: asyncio.Future[bytes] = asyncio.get_running_loop().create_future()
                self._pending[rid] = fut
                if not await self._send("kv/req", bytes([op]) + struct.pack("!H", rid) + arg):
                    self._pending.pop(rid, None)
                    raise BoardOffline()
                try:
                    answer = await asyncio.wait_for(fut, TIMEOUT_S)
                except TimeoutError:
                    self._pending.pop(rid, None)
                    log.warning("Board storage: no answer (try %d)", attempt + 1)
                    continue
                if answer[0] == ERROR:
                    raise ServiceError(500, "Board storage error: " + answer[1:].decode(errors="replace"))
                return answer[0], answer[1:]
        raise BoardOffline("The classroom board doesn't answer")

    async def get(self, key: str) -> bytes | None:
        status, value = await self._call(GET, key.encode())
        return value if status == OK else None

    async def get_many(self, keys: list[str]) -> dict[str, bytes]:
        out: dict[str, bytes] = {}
        todo = list(keys)
        while todo:
            batch = todo[:MANY_BATCH]
            _, data = await self._call(MANY, b"".join(bytes([len(k)]) + k.encode() for k in batch))
            done, i = data[0], 1
            while i < len(data):
                n = data[i]
                key = data[i + 1 : i + 1 + n].decode()
                size = struct.unpack("!I", data[i + 1 + n : i + 5 + n])[0]
                out[key] = data[i + 5 + n : i + 5 + n + size]
                i += 5 + n + size
            todo = todo[max(done, 1) :]
        return out

    async def put(self, key: str, value: bytes) -> None:
        k = key.encode()
        await self._call(PUT, bytes([len(k)]) + k + value)

    async def delete(self, key: str) -> None:
        await self._call(DEL, key.encode())

    async def keys(self, prefix: str) -> list[str]:
        out: list[str] = []
        after = b""
        while True:
            _, data = await self._call(KEYS, bytes([len(after)]) + after + prefix.encode())
            more, i = data[0], 1
            while i < len(data):
                n = data[i]
                out.append(data[i + 1 : i + 1 + n].decode())
                i += 1 + n
            if not more or not out:
                return out
            after = out[-1].encode()

    async def free(self) -> int:
        _, data = await self._call(INFO, b"")
        return struct.unpack("!I", data[:4])[0]

    # ---- MQTT
    async def run(self, host: str, port: int, user: str, password: str) -> None:
        """Stay connected to the broker (forever, reconnecting)."""
        import aiomqtt

        while True:
            try:
                async with aiomqtt.Client(
                    host,
                    port,
                    username=user or None,
                    password=password or None,
                    identifier="fog-" + self.board_id,
                ) as client:

                    async def publish(topic: str, payload: bytes, retain: bool) -> None:
                        await client.publish(topic, payload, qos=0, retain=retain)

                    for name in ("status", "kv/res", "log"):
                        await client.subscribe(self.topic(name))
                    self.attach(publish)
                    log.info("MQTT: connected to %s:%d", host, port)
                    async for message in client.messages:
                        await self.handle_message(message.topic.value, bytes(message.payload))
            except Exception as e:  # aiomqtt.MqttError, refused…
                log.warning("MQTT: %r; retrying in 5 s", e)
            finally:
                self.attach(None)
                if self.status.get("online"):
                    self.status = {"online": False}
            await asyncio.sleep(5)
