import base64
import os

import pytest

from pianocore.crypto import Keys, SealError, new_system_key


def test_seal_and_open(keys):
    blob = keys.seal({"a": 1, "name": "Ode"}, "m/abc")
    assert b"Ode" not in blob  # encrypted
    assert keys.open(blob, "m/abc") == {"a": 1, "name": "Ode"}


def test_a_blob_only_opens_under_its_key_and_with_the_right_system_key(keys):
    blob = keys.seal({"a": 1}, "m/abc")
    with pytest.raises(SealError):
        keys.open(blob, "m/other")  # moved to another record
    with pytest.raises(SealError):
        Keys(os.urandom(32)).open(blob, "m/abc")
    damaged = blob[:-1] + bytes([blob[-1] ^ 1])
    with pytest.raises(SealError):
        keys.open(damaged, "m/abc")


def test_user_ids_are_stable_case_insensitive_and_keyed(keys):
    assert keys.user_id("Ana") == keys.user_id("ana")
    assert keys.user_id("ana") != keys.user_id("ana2")
    assert keys.user_id("ana") != Keys(os.urandom(32)).user_id("ana")
    assert len(keys.user_id("ana")) == 32


def test_system_key_text():
    text = new_system_key()
    assert len(base64.b64decode(text)) == 32
    assert Keys.from_text(text).user_id("x") == Keys.from_text(text).user_id("x")
    with pytest.raises(ValueError):
        Keys.from_text("not base64!")
    with pytest.raises(ValueError):
        Keys.from_text(base64.b64encode(b"short").decode())


def test_better_auth_keys_match_the_node_side():
    """The same values web/tests/server/keys.test.ts expects from web/server/auth/keys.ts."""
    k = Keys(bytes(range(32)))
    assert k.auth_secret == "izoa-iHnFSD2LvP15ok0Q_fnBYNvnhZ3tfwRBHW9P5s"
    assert k.internal_token == "dH0OfKcF2pKGQzDXGCl8MC7CH8Y88cn9ANPTavJb8c0"
    assert k.user_id("Ana") == "e8143115f7ea501aa876646c99350f6d"
