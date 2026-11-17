import os

from pianocore.auth import key_hash, make_token, new_salt, password_ok, read_token
from pianocore.crypto import Keys
from pianocore.models import User

KEY = "ab" * 32


def user() -> User:
    salt = new_salt()
    return User(
        uid="u1", username="Ana", role="teacher", salt=salt, hash=key_hash(salt, KEY), created=1, updated=1
    )


def test_password_key():
    u = user()
    assert password_ok(u, KEY)
    assert not password_ok(u, "cd" * 32)


def test_tokens(keys):
    token = make_token(keys, user(), now=1000)
    s = read_token(keys, token, now=2000)
    assert (s.uid, s.username, s.role, s.is_teacher) == ("u1", "Ana", "teacher", True)
    assert read_token(keys, token, now=10**15) is None  # expired
    assert read_token(Keys(os.urandom(32)), token, now=2000) is None  # another system's key
    payload, sig = token.split(".")
    assert read_token(keys, payload + "x." + sig, now=2000) is None  # tampered
    for bad in (None, "", "abc", "a.b.c"):
        assert read_token(keys, bad) is None
