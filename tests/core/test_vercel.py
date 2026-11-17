"""The Vercel API (api/index.py) with an in-memory store instead of Atlas."""

import importlib.util
import json
import os

import pytest
from fastapi.testclient import TestClient

from pianocore import ably
from pianocore.auth import Session
from pianocore.crypto import Keys, new_system_key
from pianocore.repo import MemoryRepo
from pianocore.service import Service

KEY = "ab" * 32


@pytest.fixture
def client(monkeypatch):
    spec = importlib.util.spec_from_file_location("vercel_api", "api/index.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    monkeypatch.setenv("PIANO_DATA_KEY", new_system_key())
    monkeypatch.setenv("ABLY_API_KEY", "app1.key1:secret")
    svc = Service(MemoryRepo(), Keys.from_text(os.environ["PIANO_DATA_KEY"]))
    mod.app.dependency_overrides[mod.service] = lambda: svc
    return TestClient(mod.app)


def test_online_api_and_ably_tokens(client):
    assert client.get("/api/config").json() == {"mode": "online", "realtime": "ably"}
    assert client.post("/api/ably/token").status_code == 401
    token = client.post(
        "/api/auth/register", json={"username": "teach", "role": "teacher", "key": KEY}
    ).json()["token"]
    tr = client.post("/api/ably/token", headers={"Authorization": "Bearer " + token}).json()
    assert tr["clientId"] == "teach" and tr["keyName"] == "app1.key1"
    assert json.loads(tr["capability"]) == ably.capability(Session("x", "teach", "teacher"))


def test_a_missing_setting_is_reported(client, monkeypatch):
    monkeypatch.delenv("ABLY_API_KEY")
    token = client.post("/api/auth/register", json={"username": "ana", "role": "student", "key": KEY}).json()[
        "token"
    ]
    r = client.post("/api/ably/token", headers={"Authorization": "Bearer " + token})
    assert r.status_code == 503 and "ABLY_API_KEY" in r.json()["error"]


def test_bad_settings_are_reported_without_their_values(monkeypatch):
    spec = importlib.util.spec_from_file_location("vercel_api2", "api/index.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    client = TestClient(mod.app, raise_server_exceptions=False)
    monkeypatch.setenv("PIANO_DATA_KEY", '"not-base64 secret"')
    monkeypatch.setenv("MONGODB_URI", "mongodb+srv://user:hunter2@nowhere.invalid/")
    r = client.get("/api/auth/me")
    assert r.status_code == 503 and "PIANO_DATA_KEY is invalid" in r.json()["error"]
    assert "secret" not in r.text
    monkeypatch.setenv("PIANO_DATA_KEY", new_system_key())
    monkeypatch.setenv("MONGODB_URI", "mongodb://user:hunter2@host:notaport/")
    r = client.get("/api/auth/me")
    assert r.status_code == 503 and "MONGODB_URI" in r.json()["error"] and "hunter2" not in r.text
    # A valid configuration (the real dependency, no override): Atlas isn't contacted before it's needed
    monkeypatch.setenv("MONGODB_URI", "mongodb://127.0.0.1:9/")
    r = client.get("/api/auth/me")
    assert r.status_code == 401 and r.json() == {"error": "Log in first"}
