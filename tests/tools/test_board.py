"""tools/board.py: what `setup` writes on the board over USB."""

import subprocess

from tools.board import PROJECT, blob_sha, board_config, board_files


def git_hash(path: str) -> str:
    return subprocess.run(
        ["git", "hash-object", path], cwd=PROJECT, capture_output=True, text=True, check=True
    ).stdout.strip()


def test_version_file_has_the_git_hashes_the_pc_compares():
    """/version.json lists each file's git hash: the PC's updater compares them with `git ls-tree`."""
    files = board_files()
    assert ("esp32/main.py", "main.py") in files
    assert ("tests/board/testrunner.py", "tests/testrunner.py") in files
    for repo_path, _ in files[:5]:
        assert blob_sha((PROJECT / repo_path).read_bytes()) == git_hash(repo_path)
    assert blob_sha(b"") == "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"  # git's empty blob


def test_board_config_from_env():
    env = {
        "WIFI_SSID": "Aula 3",
        "WIFI_PASSWORD": "secret",
        "MQTT_BOARD_PASSWORD": "pw",
        "DUCKDNS_DOMAIN": "piano-aula3",
    }
    assert board_config(env) == {
        "board": "piano1",
        "wifi": {"ssid": "Aula 3", "password": "secret"},
        "server": "piano-aula3.duckdns.org",
        "mqtt": {"port": 8883, "user": "board-piano1", "password": "pw"},
    }
