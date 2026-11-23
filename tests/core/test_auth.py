"""Better Auth's signed session tokens, read by this side (pianocore/auth.py)."""

import os
from urllib.parse import unquote

from pianocore.auth import SessionReader, bearer, session_id, verify_signed_token
from pianocore.crypto import Keys
from pianocore.repo import MemoryRepo
from pianocore.service import Service
from tests.better_auth import new_session, sign, sign_up


def test_signed_tokens(keys):
    signed = sign(keys, "abc123")
    assert verify_signed_token(keys, signed) == "abc123"
    assert "%" in signed  # URL-encoded, like Better Auth's (its signature's base64 has = + /)
    assert verify_signed_token(keys, unquote(signed)) == "abc123"  # decoded, as a cookie may be
    assert verify_signed_token(Keys(os.urandom(32)), signed) is None  # another system's key
    assert verify_signed_token(keys, "abc124." + signed.split(".")[1]) is None  # another token
    for bad in (None, "", "abc", ".sig", "abc.", "abc.%%%"):
        assert verify_signed_token(keys, bad) is None


def test_bearer_header():
    assert bearer("Bearer abc") == "abc"
    assert bearer("bearer  abc ") == "abc"
    assert bearer("Basic abc") is None
    assert bearer(None) is None
    assert bearer("Bearer ") is None


def test_session_ids_hide_the_token():
    assert session_id("abc") != "abc" and len(session_id("abc")) == 32
    assert session_id("abc") == session_id("abc") != session_id("abd")


async def test_reading_sessions(keys):
    repo = MemoryRepo()
    svc = Service(repo, keys)
    signed = await sign_up(svc, "Ana", "teacher")
    s = await svc.sessions.read(signed)
    assert s is not None and (s.username, s.role, s.is_teacher) == ("Ana", "teacher", True)
    assert await svc.sessions.read(await new_session(svc, s.uid, days=-1)) is None  # expired
    assert await svc.sessions.read(sign(keys, "made-up")) is None  # signed, but not a session here
    # the account is gone: so is the session
    repo.users[s.uid].deleted = True
    assert await svc.sessions.read(signed) is None


async def test_answers_are_cached_for_a_while(keys):
    now = {"t": 0.0}
    repo = MemoryRepo()
    svc = Service(repo, keys)
    signed = await sign_up(svc, "ana")
    reader = SessionReader(repo, keys, ttl_s=60, clock=lambda: now["t"])
    assert await reader.read(signed) is not None
    repo.sessions.clear()  # the board drops out, say
    assert await reader.read(signed) is not None  # still trusted for up to a minute
    now["t"] = 61
    assert await reader.read(signed) is None
    reader.forget("anything")  # forgetting an unknown token is harmless
