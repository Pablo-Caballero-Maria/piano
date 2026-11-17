from fastapi import FastAPI
from fastapi.testclient import TestClient

from pianocore.api import install_error_handlers, make_router
from pianocore.repo import MemoryRepo
from pianocore.service import Service

KEY = "ab" * 32


def client(keys) -> TestClient:
    svc = Service(MemoryRepo(), keys)
    app = FastAPI()
    install_error_handlers(app)
    app.include_router(make_router(lambda: svc))
    return TestClient(app)


def test_rest_api(keys):
    c = client(keys)
    r = c.post("/api/auth/register", json={"username": "ana", "role": "teacher", "key": KEY})
    assert r.status_code == 200
    auth = {"Authorization": "Bearer " + r.json()["token"]}
    assert c.get("/api/auth/me", headers=auth).json() == {"user": {"username": "ana", "role": "teacher"}}
    assert c.get("/api/melodies").status_code == 401
    m = c.post(
        "/api/melodies", headers=auth, json={"name": "T", "bpm": 90, "notes": "60:0:1", "public": True}
    ).json()
    mid = m["melody"]["id"]
    assert c.get("/api/melodies?scope=public", headers=auth).json()["melodies"][0]["id"] == mid
    assert c.get(f"/api/melodies/{mid}", headers=auth).json()["melody"]["notes"] == "60:0:1"
    r = c.put(f"/api/melodies/{mid}", headers=auth, json={"name": "T2", "bpm": 90, "notes": ""})
    assert r.json()["melody"]["name"] == "T2"
    assert c.delete(f"/api/melodies/{mid}", headers=auth).json() == {}
    assert c.get(f"/api/melodies/{mid}", headers=auth).status_code == 404


def test_errors_are_json(keys):
    c = client(keys)
    r = c.post("/api/auth/register", json={"username": "a", "role": "student", "key": KEY})
    assert r.status_code == 400 and "username" in r.json()["error"]
    r = c.post("/api/auth/login", json={"username": "nobody", "key": KEY})
    assert r.status_code == 401 and r.json() == {"error": "Wrong username or password"}
