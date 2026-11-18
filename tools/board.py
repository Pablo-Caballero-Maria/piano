"""The classroom board over USB (mpremote): install its firmware, run its tests, watch it.

    uv run tools/board.py setup [--port /dev/ttyUSB0]   firmware + board tests + settings, restart
    uv run tools/board.py test                          run the board's test suite on the board
    uv run tools/board.py log                           what it prints (Ctrl-] to quit)

``setup`` writes the board's /config.json from .env:

- WIFI_SSID, WIFI_PASSWORD: the classroom router;
- PIANO_BOARD_ID (default piano1) and MQTT_BOARD_PASSWORD (user ``board-<id>`` in Mosquitto);
- the teacher PC's name (PIANO_PUBLIC_URL, or DUCKDNS_DOMAIN.duckdns.org): MQTT broker and update
  server; PIANO_SERVER_IP optionally skips DNS (the certificate is still checked).

Files of the old Bluetooth firmware (store.py, web.py, www/…) are removed; an old-format piano.db
is kept as piano-v1.db. /version.json records the commit and git hash of every file, so after this
the teacher's PC keeps the board up to date over WiFi (fog/updater.py, esp32/ota.py).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

PROJECT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(PROJECT / "esp32"), str(PROJECT)]
import updater  # noqa: E402  (esp32/updater.py: which files go on the board, and where)

from fog.settings import load_env_file, public_url  # noqa: E402

CLEAN = """
import os
def rm(p):
    try:
        if os.stat(p)[0] & 0x4000:
            for n in os.listdir(p):
                rm(p + "/" + n)
            os.rmdir(p)
        else:
            os.remove(p)
    except OSError:
        pass
for p in ("/www", "/tests", "/next", "/prev", "/applying", "/ota.json", "/update.json", "/version.json",
          "/store.py", "/web.py", "/net.py", "/main_off.py", "/check"):
    rm(p)
try:
    import btree
    f = open("/piano.db", "r+b")
    db = btree.open(f, pagesize=1024)
    old = any(k.startswith(b"u:") or k == b"#melody" for k in db)
    db.close()
    f.close()
    if old:
        os.rename("/piano.db", "/piano-v1.db")
        print("Kept the old Bluetooth-era database as /piano-v1.db")
except OSError:
    pass
"""
TEST = """
import sys
sys.path.insert(0, "/tests")
import testrunner
ok, summary = testrunner.run("/tests")
print("BOARD TESTS:", "PASSED" if ok else "FAILED", "-", summary)
"""


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=PROJECT, capture_output=True, text=True, check=True).stdout


def blob_sha(data: bytes) -> str:
    """The file's git hash (what `git ls-tree` lists and esp32/ota.py checks after a download)."""
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def board_files() -> list[tuple[str, str]]:
    """[(repo path, board path)] of every project file that goes on the board (tracked or new)."""
    paths = git("ls-files", "--cached", "--others", "--exclude-standard").split("\n")
    return [
        (p, updater.board_path(p))
        for p in sorted(paths)
        if p and updater.board_path(p) and (PROJECT / p).is_file()
    ]


def board_config(env: dict[str, str]) -> dict:
    missing = [k for k in ("WIFI_SSID", "MQTT_BOARD_PASSWORD") if not env.get(k)]
    if missing:
        sys.exit("Set these in .env first: " + ", ".join(missing))
    board = env.get("PIANO_BOARD_ID") or "piano1"
    server = urlparse(public_url(env)).hostname
    if server in (None, "localhost"):
        sys.exit("Set DUCKDNS_DOMAIN (or PIANO_PUBLIC_URL) in .env first: the board connects to that name")
    c = {
        "board": board,
        "wifi": {"ssid": env["WIFI_SSID"], "password": env.get("WIFI_PASSWORD", "")},
        "server": server,
        "mqtt": {"port": 8883, "user": f"board-{board}", "password": env["MQTT_BOARD_PASSWORD"]},
    }
    if env.get("PIANO_SERVER_IP"):
        c["server_ip"] = env["PIANO_SERVER_IP"]
    return c


def mpremote(port: str, *args: str, capture: bool = False) -> str:
    cmd = [sys.executable, "-m", "mpremote", "connect", port, *args]
    if capture:
        return subprocess.run(cmd, capture_output=True, text=True, check=True).stdout
    subprocess.run(cmd, check=True)
    return ""


def setup(port: str) -> None:
    env = load_env_file(PROJECT / ".env")
    files = board_files()
    sha = git("rev-parse", "HEAD").strip() + ("-dirty" if git("status", "--porcelain").strip() else "")
    version = {"sha": sha, "files": {p: blob_sha((PROJECT / p).read_bytes()) for p, _ in files}}
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / "config.json").write_text(json.dumps(board_config(env)))
        (Path(tmp) / "version.json").write_text(json.dumps(version))
        cmd = ["exec", CLEAN]
        folders = sorted({d.rsplit("/", 1)[0] for _, d in files if "/" in d})
        for d in folders:
            cmd += ["+", "mkdir", ":" + d]
        for repo_path, dest in files:
            cmd += ["+", "cp", str(PROJECT / repo_path), ":" + dest]
        for name in ("config.json", "version.json"):
            cmd += ["+", "cp", str(Path(tmp) / name), ":" + name]
        mpremote(port, *cmd)
    print(f"Installed {len(files)} files (version {sha[:7]}).")
    test(port)
    mpremote(port, "reset")
    print("The board restarts and connects to the teacher's PC.")


def test(port: str) -> None:
    out = mpremote(port, "exec", TEST, capture=True)
    print(out)
    if "BOARD TESTS: PASSED" not in out:
        sys.exit("The board's tests failed.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["setup", "test", "log"])
    ap.add_argument("--port", default="/dev/ttyUSB0", help="the board's serial port (default /dev/ttyUSB0)")
    args = ap.parse_args()
    if args.command == "setup":
        setup(args.port)
    elif args.command == "test":
        test(args.port)
    else:
        mpremote(args.port, "repl")


if __name__ == "__main__":
    main()
