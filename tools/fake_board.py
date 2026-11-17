"""A pretend classroom board on this laptop: the real firmware (esp32/app.py, run on CPython with
tools/sim) connects to the MQTT broker exactly like the ESP32, stores its data in .fake-board/,
and plays its notes on the laptop's speaker (square wave through ``pacat``, or just printed).

    uv run tools/fake_board.py          the broker's local listener (127.0.0.1:1883)
    uv run tools/fake_board.py --tls    port 8883 with the certificate check, like the real board

Uses PIANO_BOARD_ID and MQTT_BOARD_PASSWORD from .env (user ``board-<id>``). Don't run it while the
real board is connected with the same id.
"""

from __future__ import annotations

import argparse
import array
import math
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

PROJECT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(PROJECT / "esp32"), str(PROJECT / "tools" / "sim"), str(PROJECT)]
import upy  # noqa: E402

upy.install()
import app  # noqa: E402  (esp32/app.py)
import machine  # noqa: E402  (tools/sim/machine.py)
import updater  # noqa: E402  (esp32/updater.py)

from fog.settings import load_env_file  # noqa: E402

NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def note_name(freq: int) -> str:
    if freq <= 0:
        return "silence"
    m = round(69 + 12 * math.log2(freq / 440))
    return f"{NAMES[m % 12]}{m // 12 - 1}"


class Speaker:
    """Square wave on the laptop speaker, like the buzzer (needs pacat from PulseAudio/PipeWire)."""

    RATE = 22050

    def __init__(self) -> None:
        self.freq = 0
        try:
            self.proc = subprocess.Popen(
                [
                    "pacat",
                    "--raw",
                    "--format=s16le",
                    f"--rate={self.RATE}",
                    "--channels=1",
                    "--latency-msec=40",
                ],
                stdin=subprocess.PIPE,
            )
        except FileNotFoundError:
            print("pacat not found: no sound, only printing notes")
            return
        threading.Thread(target=self._run, daemon=True).start()

    def play(self, freq: int) -> None:
        self.freq = freq
        print(
            f"{time.strftime('%H:%M:%S')}  {note_name(freq):>8}  {freq} Hz"
            if freq
            else f"{time.strftime('%H:%M:%S')}  silence"
        )

    def _run(self) -> None:
        phase = 0.0
        while True:
            f = self.freq
            buf = array.array("h", bytes(2 * self.RATE // 50))  # 20 ms
            if f:
                for i in range(len(buf)):
                    phase = (phase + f / self.RATE) % 1.0
                    buf[i] = 2500 if phase < 0.5 else -2500
            self.proc.stdin.write(buf.tobytes())
            self.proc.stdin.flush()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tls", action="store_true", help="connect like the real board (8883, TLS)")
    args = ap.parse_args()
    env = load_env_file(PROJECT / ".env")
    board = env.get("PIANO_BOARD_ID", "piano1")
    folder = PROJECT / ".fake-board"
    folder.mkdir(exist_ok=True)
    updater.ROOT = str(folder)  # its version/update files live here, not in /
    machine.on_tone = Speaker().play
    config = {
        "board": board,
        "wifi": {"ssid": "laptop"},
        "server": urlparse(env.get("PIANO_PUBLIC_URL", "https://piano-esp32.duckdns.org")).hostname,
        "server_ip": "127.0.0.1",
        "mqtt": {
            "port": 8883 if args.tls else 1883,
            "tls": args.tls,
            "user": f"board-{board}",
            "password": env.get("MQTT_BOARD_PASSWORD", ""),
        },
        "ca": str(PROJECT / "esp32" / "ca.pem"),
        "buzzer_pin": 33,
        "led_pin": None,
    }
    print(f"Fake board {board}: connecting to 127.0.0.1:{config['mqtt']['port']} (Ctrl-C to stop)")
    try:
        app.Board(config, store_path=str(folder / "board.db")).run()
    except machine.Reset:
        print("The board was asked to restart (an update): run the real board to try updates.")
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
