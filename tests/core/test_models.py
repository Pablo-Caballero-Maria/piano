import pytest

from pianocore.models import (
    AuthSession,
    Invalid,
    Melody,
    check_melody,
    check_password_hash,
    check_role,
    check_username,
)


def test_usernames_roles_and_password_hashes():
    assert check_username("ana_1.x-y") == "ana_1.x-y"
    for bad in ("ab", "a" * 33, "bad name", "ñandú", None, 5):
        with pytest.raises(Invalid):
            check_username(bad)
    assert check_role("teacher") == "teacher"
    with pytest.raises(Invalid):
        check_role("admin")
    assert check_password_hash("0" * 32, "f" * 64) == ("0" * 32, "f" * 64)
    for salt, hash in [("xyz", "f" * 64), ("0" * 32, "F" * 64), ("0" * 32, None), (1, "f" * 64)]:
        with pytest.raises(Invalid):
            check_password_hash(salt, hash)


def test_sessions_expire():
    s = AuthSession(sid="s", id="i", token="t", uid="u", expires=1000, created=1, updated=1)
    assert s.expired(now=1000) and not s.expired(now=999)
    assert AuthSession.from_dict(s.to_dict()) == s


def test_melody_validation():
    m = check_melody(
        {"name": "  Ode   to  joy ", "bpm": 120, "notes": " 64:0:1  64:1:0.5 ", "length": 2, "public": 1}
    )
    assert (m.name, m.notes, m.public) == ("Ode to joy", "64:0:1 64:1:0.5", True)
    assert check_melody({"name": "x", "bpm": 90, "notes": "", "length": -3}).length == 0
    for bad in (
        None,
        {"name": "", "bpm": 120, "notes": ""},
        {"name": "x", "bpm": 5, "notes": ""},
        {"name": "x", "bpm": True, "notes": ""},
        {"name": "x", "bpm": 120, "notes": "60:0:1; drop"},
        {"name": "x", "bpm": 120, "notes": "200:0:1"},
        {"name": "x", "bpm": 120, "notes": "60:0:1 " * 3000},
    ):
        with pytest.raises(Invalid):
            check_melody(bad)


def test_melody_views():
    m = Melody(
        id="a" * 32,
        owner="u",
        owner_name="Ana",
        name="Tune",
        bpm=100,
        notes="60:0:1 62:1:1",
        length=2,
        public=True,
        created=1,
        updated=2,
        edited_by="Bob",
    )
    assert m.summary()["noteCount"] == 2 and "notes" not in m.summary()
    assert m.full()["notes"] == "60:0:1 62:1:1" and m.full()["editedBy"] == "Bob"
    assert Melody.from_dict({**m.to_dict(), "unknown": 1}) == m
