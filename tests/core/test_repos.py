"""The same behaviour from every repository (memory, board key/value; Atlas in test_mongo.py)."""

from pianocore.models import Melody, User


def user(uid="u1", name="ana", updated=1, **kw) -> User:
    return User(
        uid=uid, username=name, role="student", salt="00", hash="11", created=1, updated=updated, **kw
    )


def melody(mid, owner="u1", public=False, updated=1, deleted=False) -> Melody:
    return Melody(
        id=mid,
        owner=owner,
        owner_name="ana",
        name="m" + mid[:3],
        bpm=120,
        notes="60:0:1",
        length=1,
        public=public,
        created=1,
        updated=updated,
        edited_by="ana",
        deleted=deleted,
    )


async def check_repo_contract(repo):
    assert await repo.get_user("u1") is None
    await repo.put_user(user())
    await repo.put_user(user("u2", "bob", updated=5))
    assert (await repo.get_user("u1")).username == "ana"
    assert set(await repo.get_users(["u1", "u2", "nope"])) == {"u1", "u2"}
    assert {u.uid for u in await repo.all_users()} == {"u1", "u2"}
    await repo.delete_user("u2")
    assert await repo.get_user("u2") is None

    a, b, c, d = ("a" * 32, "b" * 32, "c" * 32, "d" * 32)
    await repo.put_melody(melody(a, updated=10))
    await repo.put_melody(melody(b, public=True, updated=20))
    await repo.put_melody(melody(c, owner="u2", public=True, updated=30))
    await repo.put_melody(melody(d, owner="u2", updated=40))
    ids = lambda ms: sorted(m.id for m in ms)  # noqa: E731
    assert ids(await repo.find_melodies(owners=["u1"])) == [a, b]
    assert ids(await repo.find_melodies(public=True)) == [b, c]
    assert ids(await repo.find_melodies(owners=["u1"], public=True)) == [a, b, c]
    assert ids(await repo.find_melodies(owners=["u1", "u2"], since=20)) == [b, c, d]
    # Visibility changes move it in or out of the public index
    await repo.put_melody(melody(c, owner="u2", public=False, updated=50))
    assert ids(await repo.find_melodies(public=True)) == [b]
    # Tombstones only show up when asked for
    await repo.put_melody(melody(a, updated=60, deleted=True))
    assert ids(await repo.find_melodies(owners=["u1"])) == [b]
    assert ids(await repo.find_melodies(owners=["u1"], with_deleted=True)) == [a, b]
    assert set(await repo.get_melodies([a, b, "x" * 32])) == {a, b}
    await repo.drop_melody(b)
    assert await repo.get_melody(b) is None
    assert ids(await repo.find_melodies(owners=["u1"], public=True, with_deleted=True)) == [a]

    assert await repo.get_alias("old") is None
    await repo.put_alias("old", "new")
    assert await repo.get_alias("old") == "new"
    assert await repo.get_meta("sync") == {}
    await repo.put_meta("sync", {"since": 5})
    assert await repo.get_meta("sync") == {"since": 5}


async def test_repo_contract(repo):
    await check_repo_contract(repo)


async def test_board_store_holds_only_ciphertext(keys):
    from pianocore.kv_repo import KVRepo, MemoryKV

    kv = MemoryKV()
    repo = KVRepo(kv, keys)
    await repo.put_user(user(name="secretname"))
    await repo.put_melody(melody("a" * 32))
    assert all(b"secretname" not in v and b"60:0:1" not in v for v in kv.data.values())
    assert await repo.free_bytes() < kv.capacity
