"""The teacher's PC app end to end (FastAPI TestClient), with the board's real storage code."""

import json

import pytest
from fastapi.testclient import TestClient

from fog.app import Fog, create_app
from fog.settings import REPO_DIR, Settings
from fog.simboard import SimulatedBoard as LoopbackBoard
from pianocore.crypto import new_system_key

KEY = "ab" * 32


@pytest.fixture
def setup(tmp_path):
    board = LoopbackBoard(tmp_path)
    settings = Settings(data_key=new_system_key(), board_id="t1", repo_dir=REPO_DIR, auto_update=False)
    fog = Fog.build(settings, board=board.link)
    with TestClient(create_app(settings, fog, background=False)) as client:
        yield client, fog, board
    board.close()


def account(client, name, role="student"):
    r = client.post("/api/auth/register", json={"username": name, "role": role, "key": KEY})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def test_accounts_and_melodies_live_on_the_board(setup):
    client, _fog, board = setup
    token = account(client, "ana", "teacher")
    auth = {"Authorization": "Bearer " + token}
    r = client.post(
        "/api/melodies", headers=auth, json={"name": "Ode", "bpm": 100, "notes": "64:0:1", "public": True}
    )
    assert r.status_code == 200
    stored = board.store.db.get(b"m/" + r.json()["melody"]["id"].encode())
    assert stored and b"Ode" not in stored  # on the board, encrypted
    assert client.get("/api/config").json()["mode"] == "classroom"
    status = client.get("/api/status", headers=auth).json()
    assert status["board"]["online"] and status["internet"] is False
    student = {"Authorization": "Bearer " + account(client, "bob")}
    assert client.get("/api/status", headers=student).status_code == 403
    board.link.status = {"online": False}
    r = client.post("/api/melodies", headers=auth, json={"name": "X", "bpm": 100, "notes": ""})
    assert r.status_code == 503 and "offline" in r.json()["error"]


def test_the_class_over_websockets(setup):
    client, _fog, board = setup
    teacher, student = account(client, "teach", "teacher"), account(client, "ana")
    with client.websocket_connect("/ws") as t, client.websocket_connect("/ws") as s:
        t.send_json({"t": "hello", "token": teacher, "mode": "piano"})
        assert t.receive_json()["t"] == "welcome"
        s.send_json({"t": "hello", "token": student, "mode": "studio"})
        welcome = s.receive_json()
        assert welcome["you"]["name"] == "ana" and welcome["board"]["online"]
        assert t.receive_json()["t"] == "people"  # just me
        people = t.receive_json()
        assert people["t"] == "people" and {p["name"] for p in people["people"]} == {"teach", "ana"}
        t.send_json({"t": "live", "on": True, "mode": "piano"})
        assert s.receive_json() == {"t": "lesson", "live": "teach", "mode": "piano"}
        assert s.receive_json()["t"] == "buzzer"
        t.send_json({"t": "note", "freq": 440, "midi": [69]})
        assert s.receive_json() == {"t": "teacher.note", "freq": 440, "midi": [69]}
    assert 440 in board.tones


def test_a_websocket_without_login_is_refused(setup):
    client, _, _ = setup
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"t": "hello", "token": "forged"})
        assert ws.receive_json() == {"t": "error", "message": "Log in to join the class"}


def test_the_board_downloads_its_files_from_git(setup):
    client, _fog, _ = setup
    import subprocess

    head = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=REPO_DIR, capture_output=True, text=True
    ).stdout.strip()
    manifest = client.get(f"/board/{head}/manifest.json").json()
    if "esp32/app.py" not in manifest["files"]:
        pytest.skip("the current commit predates the new board firmware")
    _blob, size = manifest["files"]["esp32/app.py"]
    data = client.get(f"/board/{head}/esp32/app.py").content
    assert len(data) == size
    assert client.get(f"/board/{head}/README.md").status_code == 404
    assert client.get("/board/" + "f" * 40 + "/manifest.json").status_code == 404
    assert client.get("/board/HEAD/manifest.json").status_code == 404
    assert json.loads(client.get("/api/config").content)["realtime"] == "ws"
