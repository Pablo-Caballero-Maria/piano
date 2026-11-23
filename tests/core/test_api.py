from fastapi import FastAPI
from fastapi.testclient import TestClient

from pianocore.accounts_api import make_accounts_router
from pianocore.api import install_error_handlers, make_router
from pianocore.repo import MemoryRepo
from pianocore.service import Service
from tests.better_auth import bearer, http_sign_up, internal, sign


def client(keys) -> TestClient:
    svc = Service(MemoryRepo(), keys)
    app = FastAPI()
    install_error_handlers(app)
    app.include_router(make_router(lambda: svc))
    app.include_router(make_accounts_router("/internal/accounts", lambda: svc))
    return TestClient(app)


def test_rest_api(keys):
    c = client(keys)
    auth = bearer(http_sign_up(c, keys, "ana", "teacher"))
    assert c.get("/api/me", headers=auth).json() == {
        "user": {"username": "ana", "role": "teacher"},
        "notice": "",
    }
    assert c.get("/api/melodies").status_code == 401
    assert c.get("/api/melodies", headers=bearer(sign(keys, "not-a-session"))).status_code == 401
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
    r = c.post(
        "/internal/accounts/register", headers=internal(keys), json={"username": "a", "role": "student"}
    )
    assert r.status_code == 400 and "username" in r.json()["error"]
    r = c.get("/api/me")
    assert r.status_code == 401 and r.json() == {"error": "Log in first"}


def test_the_accounts_api_is_internal(keys):
    c = client(keys)
    assert c.post("/internal/accounts/find", json={"username": "ana"}).status_code == 403
    r = c.post("/internal/accounts/find", headers={"X-Piano-Internal": "guess"}, json={"username": "ana"})
    assert r.status_code == 403 and r.json() == {"error": "Internal API"}


def test_the_accounts_api(keys):
    c = client(keys)
    h = internal(keys)
    signed = http_sign_up(c, keys, "Ana", "teacher")
    account = c.post("/internal/accounts/find", headers=h, json={"username": "ANA"}).json()["account"]
    assert (account["username"], account["role"], len(account["salt"]), len(account["hash"])) == (
        "Ana",
        "teacher",
        32,
        64,
    )
    assert (
        c.post("/internal/accounts/get", headers=h, json={"uid": account["uid"]}).json()["account"] == account
    )
    assert c.post("/internal/accounts/get", headers=h, json={"uid": "nope"}).json() == {"account": None}
    assert c.post("/internal/accounts/taken", headers=h, json={"username": "ana"}).json() == {"taken": True}
    r = c.post(
        "/internal/accounts/register",
        headers=h,
        json={"username": "ana", "role": "student", "salt": "00" * 16, "hash": "11" * 32},
    )
    assert r.status_code == 409

    sessions = c.post("/internal/accounts/sessions/of", headers=h, json={"uid": account["uid"]}).json()[
        "sessions"
    ]
    assert len(sessions) == 1 and sessions[0]["uid"] == account["uid"]
    token = sessions[0]["token"]
    got = c.post("/internal/accounts/sessions/get", headers=h, json={"token": token}).json()["session"]
    assert got == sessions[0]
    assert c.get("/api/me", headers=bearer(signed)).status_code == 200
    assert c.post("/internal/accounts/sessions/delete", headers=h, json={"token": token}).json() == {}
    assert c.post("/internal/accounts/sessions/get", headers=h, json={"token": token}).json() == {
        "session": None
    }
    assert c.get("/api/me", headers=bearer(signed)).status_code == 401  # signed out

    bad = c.post("/internal/accounts/sessions/put", headers=h, json={"session": {"token": "t", "uid": "u"}})
    assert bad.status_code == 400
    assert c.post("/internal/accounts/sessions/put", headers=h, json={}).status_code == 400
    ok = {"token": "t", "uid": account["uid"], "id": "i", "expires": 10**15}
    assert c.post("/internal/accounts/sessions/put", headers=h, json={"session": ok}).status_code == 200
    r = c.post("/internal/accounts/sessions/delete-of", headers=h, json={"uid": account["uid"]})
    assert r.json() == {"deleted": 1}
