"""Passwords and sessions.

Passwords never leave the browser: it sends ``PBKDF2-SHA256(password, "esp32-piano|" + username)``
(the *password key*, 64 hex digits), and the servers store ``sha256(random salt + key)``.

A session is a signed token, ``<payload>.<signature>`` (both base64url), with the user's id, name,
role and expiry, signed with a key derived from the system key. The servers keep no session
table: any server holding the system key (the teacher PCs, Vercel) can check a token.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from dataclasses import dataclass

from .crypto import Keys
from .models import User, now_ms

TOKEN_TTL_MS = 30 * 24 * 3600 * 1000


def new_salt() -> str:
    return os.urandom(16).hex()


def key_hash(salt: str, key: str) -> str:
    return hashlib.sha256(bytes.fromhex(salt) + key.encode()).hexdigest()


def password_ok(user: User, key: str) -> bool:
    return hmac.compare_digest(key_hash(user.salt, key), user.hash)


@dataclass(frozen=True)
class Session:
    uid: str
    username: str
    role: str

    @property
    def is_teacher(self) -> bool:
        return self.role == "teacher"


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def make_token(keys: Keys, user: User, now: int | None = None) -> str:
    exp = (now if now is not None else now_ms()) + TOKEN_TTL_MS
    payload = _b64(json.dumps({"u": user.uid, "n": user.username, "r": user.role, "e": exp}).encode())
    sig = _b64(hmac.new(keys.session, payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{sig}"


def read_token(keys: Keys, token: str | None, now: int | None = None) -> Session | None:
    """The session in a token, or None if it's missing, forged or expired."""
    if not token or token.count(".") != 1:
        return None
    payload, sig = token.split(".")
    want = _b64(hmac.new(keys.session, payload.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, want):
        return None
    try:
        data = json.loads(_unb64(payload))
    except ValueError:
        return None
    if data.get("e", 0) < (now if now is not None else now_ms()):
        return None
    return Session(uid=data["u"], username=data["n"], role=data["r"])
