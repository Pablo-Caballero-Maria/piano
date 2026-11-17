import pytest

from pianocore.auth import read_token
from pianocore.repo import MemoryRepo
from pianocore.service import Service, ServiceError

KEY, KEY2 = "ab" * 32, "cd" * 32
TUNE = {"name": "Tune", "bpm": 120, "notes": "60:0:1", "length": 1}


@pytest.fixture
def svc(repo, keys):
    return Service(repo, keys)


async def session(svc, name="ana", role="student", key=KEY):
    reply = await svc.register(name, role, key)
    return read_token(svc.keys, reply["token"])


async def test_accounts(svc):
    r = await svc.register("Ana", "teacher", KEY)
    assert r["user"] == {"username": "Ana", "role": "teacher"}
    with pytest.raises(ServiceError) as e:
        await svc.register("ana", "student", KEY2)  # names ignore case
    assert e.value.status == 409
    assert (await svc.login("ANA", KEY))["user"]["role"] == "teacher"
    with pytest.raises(ServiceError) as e:
        await svc.login("ana", KEY2)
    assert e.value.status == 401
    s = read_token(svc.keys, r["token"])
    assert (await svc.me(s))["user"]["username"] == "Ana"


async def test_private_and_public_melodies(svc):
    ana, bob = await session(svc, "ana"), await session(svc, "bob", key=KEY2)
    private = await svc.create_melody(ana, TUNE)
    public = await svc.create_melody(ana, {**TUNE, "name": "Shared", "public": True})
    assert sorted(m["name"] for m in await svc.list_melodies(ana, "mine")) == ["Shared", "Tune"]
    assert [m["name"] for m in await svc.list_melodies(bob, "mine")] == []
    assert [m["name"] for m in await svc.list_melodies(bob, "public")] == ["Shared"]
    with pytest.raises(ServiceError) as e:
        await svc.get_melody(bob, private["id"])
    assert e.value.status == 404
    # Everyone can edit a public melody; only the owner changes its visibility or deletes it
    edited = await svc.update_melody(bob, public["id"], {**TUNE, "name": "Shared v2", "public": False})
    assert (edited["name"], edited["public"], edited["editedBy"], edited["owner"]) == (
        "Shared v2",
        True,
        "bob",
        "ana",
    )
    with pytest.raises(ServiceError) as e:
        await svc.delete_melody(bob, public["id"])
    assert e.value.status == 403
    await svc.delete_melody(ana, public["id"])
    assert await svc.list_melodies(bob, "public") == []
    with pytest.raises(ServiceError):
        await svc.get_melody(ana, public["id"])
    with pytest.raises(ServiceError):
        await svc.list_melodies(ana, "everything")


async def test_a_full_board_refuses_new_melodies(keys):
    repo = MemoryRepo()
    svc = Service(repo, keys)
    ana = await session(svc)
    repo.capacity = 1000
    with pytest.raises(ServiceError) as e:
        await svc.create_melody(ana, TUNE)
    assert e.value.status == 507


async def test_changes_are_announced(keys):
    calls = []

    async def changed():
        calls.append(1)

    svc = Service(MemoryRepo(), keys, on_change=changed)
    ana = await session(svc)
    await svc.create_melody(ana, TUNE)
    assert len(calls) == 2


# ---- On a teacher's PC: the board is the repo, Atlas the upstream when online -------------------
async def test_signing_up_checks_atlas_when_online(keys):
    board, atlas = MemoryRepo(), MemoryRepo()
    online = {"on": True}
    svc = Service(board, keys, upstream=lambda: atlas if online["on"] else None)
    await Service(atlas, keys).register("taken", "student", KEY)
    with pytest.raises(ServiceError) as e:
        await svc.register("taken", "student", KEY)
    assert e.value.status == 409
    await svc.register("ana", "student", KEY)
    uid = keys.user_id("ana")
    assert not board.users[uid].pending and uid in atlas.users  # confirmed right away
    online["on"] = False
    await svc.register("offline", "student", KEY)
    assert board.users[keys.user_id("offline")].pending  # confirmed at the next sync


async def test_someone_from_another_class_logs_in_and_joins_this_one(keys):
    board, atlas = MemoryRepo(), MemoryRepo()
    await Service(atlas, keys).register("visitor", "student", KEY)
    svc = Service(board, keys, upstream=lambda: atlas)
    assert (await svc.login("visitor", KEY))["user"]["username"] == "visitor"
    assert keys.user_id("visitor") in board.users


async def test_atlas_failing_counts_as_offline(keys):
    class Broken(MemoryRepo):
        async def get_user(self, uid):
            raise OSError("no internet")

    board = MemoryRepo()
    svc = Service(board, keys, upstream=lambda: Broken())
    await svc.register("ana", "student", KEY)
    assert board.users[keys.user_id("ana")].pending
