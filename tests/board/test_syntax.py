# Every file of the board's code compiles (on the board: with MicroPython's own compiler, so it
# catches what MicroPython doesn't support). main.py runs at boot and isn't imported by any test.
import os

import kv


def test_board_code_compiles():
    path = kv.__file__
    folder = path.rsplit("/", 1)[0] if "/" in path else "."
    names = [n for n in os.listdir(folder) if n.endswith(".py")]
    for needed in ("main.py", "app.py", "config.py", "kv.py", "mqtt.py", "ota.py", "tone.py", "updater.py"):
        assert needed in names, needed
    for name in names:
        with open(folder + "/" + name) as f:
            compile(f.read(), name, "exec")
