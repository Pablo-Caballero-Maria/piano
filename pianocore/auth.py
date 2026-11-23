"""Sign-in sessions: who is calling the API.

Accounts and sessions are Better Auth's (web/server/auth, a Node server next to this app on the
teacher's PC, a Node function on Vercel). Signing up, in and out goes there; its store keeps the
records here (:mod:`pianocore.accounts_api`). The page then sends Better Auth's *signed* session
token, ``<token>.<signature>`` (URL-encoded), as ``Authorization: Bearer …`` to this API and in
the live class's hello, and :class:`SessionReader` checks it without asking Better Auth:

1. the signature is Better Auth's: base64 HMAC-SHA256 of the token with its secret, which both
   sides derive from the system key (``Keys.auth_secret``);
2. the session is in this server's store (sealed, under ``session_id(token)``) and not expired;
3. its account still exists.

Passwords never leave the browser: it sends ``PBKDF2-SHA256(password, "esp32-piano|" + username)``
as the password, and Better Auth stores ``sha256(salt + key)`` (web/server/auth/password.ts).
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import time
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import unquote

from .crypto import Keys
from .repo import Repo


@dataclass(frozen=True)
class Session:
    uid: str
    username: str
    role: str

    @property
    def is_teacher(self) -> bool:
        return self.role == "teacher"


def session_id(token: str) -> str:
    """Where a session is stored: a hash of its token, so a store's keys don't reveal tokens."""
    return hashlib.sha256(token.encode()).hexdigest()[:32]


def _decode_signature(text: str) -> bytes | None:
    """Better Auth writes standard base64; accept base64url too (with or without padding)."""
    padded = text + "=" * (-len(text) % 4)
    try:
        return base64.b64decode(padded.replace("-", "+").replace("_", "/"), validate=True)
    except (ValueError, binascii.Error):
        return None


def verify_signed_token(keys: Keys, signed: str | None) -> str | None:
    """The session token in Better Auth's signed ``<token>.<signature>``, or None if it's forged."""
    if not signed:
        return None
    value = unquote(signed.strip())
    token, dot, signature = value.rpartition(".")
    if not dot or not token or not signature:
        return None
    given = _decode_signature(signature)
    want = hmac.new(keys.auth_secret.encode(), token.encode(), hashlib.sha256).digest()
    return token if given is not None and hmac.compare_digest(given, want) else None


def bearer(authorization: str | None) -> str | None:
    """The token of an ``Authorization: Bearer …`` header."""
    if not authorization or authorization[:7].lower() != "bearer ":
        return None
    return authorization[7:].strip() or None


class SessionReader:
    """Turns a signed session token into a :class:`Session` (None: logged out, expired or forged).

    Answers are cached for ``ttl_s`` seconds: on the teacher's PC the sessions live on the board
    (over MQTT), and the live class must keep working if the board drops out for a moment. Signing
    out deletes the session in the store; a cached answer outlives it by ``ttl_s`` at most.
    """

    def __init__(
        self, repo: Repo, keys: Keys, ttl_s: float = 60, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self.repo, self.keys, self.ttl_s, self.clock = repo, keys, ttl_s, clock
        self._cache: dict[str, tuple[float, Session]] = {}

    async def read(self, signed: str | None) -> Session | None:
        token = verify_signed_token(self.keys, signed)
        if token is None:
            return None
        now = self.clock()
        hit = self._cache.get(token)
        if hit and now - hit[0] < self.ttl_s:
            return hit[1]
        stored = await self.repo.get_session(session_id(token))
        if stored is None or stored.token != token or stored.expired():
            self._cache.pop(token, None)
            return None
        user = await self.repo.get_user(stored.uid)
        if user is None or user.deleted:
            return None
        session = Session(uid=user.uid, username=user.username, role=user.role)
        if len(self._cache) > 1000:  # a classroom has dozens of phones: just start over
            self._cache.clear()
        self._cache[token] = (now, session)
        return session

    def forget(self, token: str) -> None:
        self._cache.pop(token, None)
