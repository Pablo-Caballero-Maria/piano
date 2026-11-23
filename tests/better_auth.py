"""What Better Auth (web/server/auth) does with the accounts store, for the Python tests.

The real Better Auth is a Node server (tested in web/tests/server and, end to end, by
tests/test_auth_server.py and the website's e2e tests). Here it's emulated the way it uses this
side: its password hasher (web/server/auth/password.ts), its signed session tokens, and its
sign-up and sign-in flows, either straight on a Service's accounts or over HTTP through the
internal accounts API (pianocore/accounts_api.py), exactly as its store does.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import uuid
from typing import Any
from urllib.parse import quote

from pianocore.auth import Session
from pianocore.crypto import Keys
from pianocore.models import now_ms
from pianocore.service import Service, ServiceError

KEY, KEY2 = "ab" * 32, "cd" * 32  # password keys: what the browser sends (PBKDF2 of the password)
DAY_MS = 24 * 3600 * 1000


def password_hash(key: str, salt: str | None = None) -> tuple[str, str]:
    """Better Auth's hasher: sha256(salt + password key), with a random 16-byte salt."""
    salt = salt or os.urandom(16).hex()
    return salt, hashlib.sha256(bytes.fromhex(salt) + key.encode()).hexdigest()


def sign(keys: Keys, token: str) -> str:
    """The signed token Better Auth hands out (its cookie value / set-auth-token header)."""
    signature = base64.b64encode(hmac.new(keys.auth_secret.encode(), token.encode(), hashlib.sha256).digest())
    return quote(f"{token}.{signature.decode()}", safe="")


def new_session_fields(uid: str, days: int = 30) -> dict[str, Any]:
    now = now_ms()
    return {
        "token": secrets.token_urlsafe(24),
        "uid": uid,
        "id": uuid.uuid4().hex,
        "expires": now + days * DAY_MS,
        "created": now,
        "updated": now,
    }


# ---- straight on a Service
async def new_session(svc: Service, uid: str, days: int = 30) -> str:
    fields = new_session_fields(uid, days)
    await svc.accounts.put_session(**fields)
    return sign(svc.keys, fields["token"])


async def sign_up(svc: Service, name: str, role: str = "student", key: str = KEY) -> str:
    if await svc.accounts.taken(name):
        raise ServiceError(409, "That username is already taken")
    user = await svc.accounts.register(name, role, *password_hash(key))
    return await new_session(svc, user.uid)


async def sign_in(svc: Service, name: str, key: str = KEY) -> str:
    """Better Auth's sign-in hook picks the candidate whose password matches, then signs in."""
    for user in await svc.accounts.candidates(name):
        if password_hash(key, user.salt)[1] == user.hash:
            return await new_session(svc, user.uid)
    raise ServiceError(401, "Invalid username or password")


async def session_of(svc: Service, signed: str) -> Session:
    s = await svc.sessions.read(signed)
    assert s is not None
    return s


async def login(svc: Service, name: str, role: str = "student", key: str = KEY) -> Session:
    """Sign in, or sign up first; the Session the API then sees."""
    try:
        signed = await sign_in(svc, name, key)
    except ServiceError:
        signed = await sign_up(svc, name, role, key)
    return await session_of(svc, signed)


# ---- over HTTP, as Better Auth's store calls the accounts API
def internal(keys: Keys) -> dict[str, str]:
    return {"X-Piano-Internal": keys.internal_token}


def http_sign_up(
    client: Any, keys: Keys, name: str, role: str = "student", key: str = KEY, prefix: str = ""
) -> str:
    """Sign up through the accounts API (``prefix``: "/api/internal/accounts" on Vercel); the signed token."""
    base = prefix or "/internal/accounts"
    assert client.post(f"{base}/taken", headers=internal(keys), json={"username": name}).json() == {
        "taken": False
    }
    salt, hash = password_hash(key)
    r = client.post(
        f"{base}/register",
        headers=internal(keys),
        json={"username": name, "role": role, "salt": salt, "hash": hash},
    )
    assert r.status_code == 200, r.text
    fields = new_session_fields(r.json()["account"]["uid"])
    assert (
        client.post(f"{base}/sessions/put", headers=internal(keys), json={"session": fields}).status_code
        == 200
    )
    return sign(keys, fields["token"])


def bearer(signed: str) -> dict[str, str]:
    return {"Authorization": "Bearer " + signed}
