"""A simulated classroom board inside the PC's process: the board's own storage code
(esp32/kv.py, run on CPython with tools/sim) answering the BoardLink directly, no MQTT broker.

Used by the tests and by ``uv run python -m fog demo`` (try everything without a board).
"""

from __future__ import annotations

import asyncio
import struct
import sys
from collections.abc import Callable
from pathlib import Path

from .board import BoardLink

_REPO = Path(__file__).resolve().parent.parent
for _p in (_REPO / "esp32", _REPO / "tools" / "sim"):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

import kv  # noqa: E402  (esp32/kv.py)
import upy  # noqa: E402  (tools/sim)

upy.install()


class SimulatedBoard:
    """esp32/kv.Store in ``folder``, plus the buzzer: ``on_tone(freq)`` hears what it plays."""

    def __init__(
        self,
        folder: Path | str,
        board_id: str = "piano1",
        answer: bool = True,
        on_tone: Callable[[int], None] | None = None,
    ) -> None:
        self.store = kv.Store(str(folder) + "/board.db")
        self.link = BoardLink(board_id)
        self.tones: list[int] = []
        self.sent: list[tuple[str, bytes]] = []
        self.answer = answer
        self.on_tone = on_tone
        self.link.attach(self.publish)
        self.link.status = {"online": True, "sha": "", "free": self.store.free(), "simulated": True}

    async def publish(self, topic: str, payload: bytes, retain: bool) -> None:
        self.sent.append((topic, payload))
        name = topic.removeprefix(self.link.topic(""))
        if name == "tone":
            freq = struct.unpack("<H", payload)[0]
            self.tones.append(freq)
            if self.on_tone:
                self.on_tone(freq)
        elif name == "kv/req" and self.answer:
            answer = self.store.handle(payload)
            asyncio.get_running_loop().call_soon(
                lambda: asyncio.ensure_future(self.link.handle_message(self.link.topic("kv/res"), answer))
            )

    def close(self) -> None:
        self.store.close()
