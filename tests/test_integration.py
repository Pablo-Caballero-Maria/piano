"""The board and the teacher's PC talking through a real MQTT broker (amqtt, in this process).

The board side is the real firmware (esp32/app.py with its own MQTT client, on CPython thanks to
tools/sim) in a thread; the PC side is fog.board.BoardLink with aiomqtt. Covers the protocol end
to end: status and last will, storage requests, the buzzer, marking a new version good.
"""

import asyncio
import contextlib
import json
import socket
import threading

import app as board_app  # esp32/app.py
import machine  # tools/sim/machine.py
import mqtt as board_mqtt  # esp32/mqtt.py
import pytest
import updater as board_updater  # esp32/updater.py

from fog.board import BoardLink
from pianocore.kv_repo import KVRepo
from tests.core.test_repos import check_repo_contract

amqtt_broker = pytest.importorskip("amqtt.broker")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def wait_for(cond, secs=10.0):
    for _ in range(int(secs * 20)):
        if cond():
            return True
        await asyncio.sleep(0.05)
    return False


@pytest.fixture
async def broker():
    port = free_port()
    b = amqtt_broker.Broker(
        {
            "listeners": {"default": {"type": "tcp", "bind": f"127.0.0.1:{port}"}},
            "plugins": {"amqtt.plugins.authentication.AnonymousAuthPlugin": {"allow_anonymous": True}},
        }
    )
    await b.start()
    yield port
    await b.shutdown()


class BoardThread:
    """The board's firmware running its MQTT session in a thread, until stop()."""

    def __init__(self, port, folder, abrupt=False):
        self.stop_flag = threading.Event()
        self.tones = []
        machine.on_tone = self.tones.append
        config = {
            "board": "itest",
            "wifi": {"ssid": "x"},
            "server": "127.0.0.1",
            "mqtt": {"port": port, "tls": False},
            "buzzer_pin": 33,
            "led_pin": None,
        }
        self.board = board_app.Board(config, store_path=str(folder / "board.db"))
        real_keepalive, real_close = board_mqtt.MQTT.keepalive, board_mqtt.MQTT.close
        flag = self.stop_flag

        def keepalive(client):
            if flag.is_set():
                raise OSError("test over")
            real_keepalive(client)

        def close(client):
            if abrupt:  # vanish without DISCONNECT: the broker must publish the last will
                client.sock.close()
            else:
                real_close(client)

        self._patches = [(board_mqtt.MQTT, "keepalive", keepalive), (board_mqtt.MQTT, "close", close)]
        self._saved = [(cls, name, getattr(cls, name)) for cls, name, _ in self._patches]
        for cls, name, fn in self._patches:
            setattr(cls, name, fn)
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def _run(self):
        with contextlib.suppress(OSError):
            self.board.session()

    def stop(self):
        self.stop_flag.set()
        self.thread.join(5)
        for cls, name, fn in self._saved:
            setattr(cls, name, fn)
        self.board.store.close()
        machine.on_tone = None


@pytest.fixture
def board_root(tmp_path, monkeypatch):
    monkeypatch.setattr(board_updater, "ROOT", str(tmp_path))
    return tmp_path


async def test_board_and_pc_through_a_real_broker(broker, board_root, keys):
    # A freshly installed version on trial: reaching the PC must make it permanent
    (board_root / "update.json").write_text(json.dumps({"trial": "abc", "boots": 1}))
    link = BoardLink("itest")
    pc = asyncio.create_task(link.run("127.0.0.1", broker, "", ""))
    board = BoardThread(broker, board_root)
    try:
        assert await wait_for(lambda: link.online), "the PC never saw the board online"
        assert "trial" not in json.loads((board_root / "update.json").read_text())
        await check_repo_contract(KVRepo(link, keys))  # all storage, through MQTT
        await link.tone(440)
        await link.tone(0)
        assert await wait_for(lambda: board.tones[-2:] == [440, 0])
    finally:
        board.stop()
        pc.cancel()


async def test_the_last_will_tells_the_pc_when_the_board_vanishes(broker, board_root):
    link = BoardLink("itest")
    pc = asyncio.create_task(link.run("127.0.0.1", broker, "", ""))
    board = BoardThread(broker, board_root, abrupt=True)
    try:
        assert await wait_for(lambda: link.online)
        board.stop()
        assert await wait_for(lambda: not link.online), "no last will after the board vanished"
    finally:
        pc.cancel()
