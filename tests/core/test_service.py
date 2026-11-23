import pytest

from pianocore.repo import MemoryRepo
from pianocore.service import Service, ServiceError
from tests.better_auth import KEY, KEY2, login, session_of, sign_in, sign_up

TUNE = {"name": "Tune", "bpm": 120, "notes": "60:0:1", "length": 1}


@pytest.fixture
def svc(repo, keys):
    return Service(repo, keys)


async def session(svc, name="ana", role="student", key=KEY):
    return await session_of(svc, await sign_up(svc, name, role, key))


async def test_accounts(svc):
    s = await session_of(svc, await sign_up(svc, "Ana", "teacher"))
    assert await svc.accounts.me(s.uid) == {"user": {"username": "Ana", "role": "teacher"}, "notice": ""}
    assert await svc.accounts.taken("ANA")  # names ignore case
    with pytest.raises(ServiceError) as e:
        await svc.accounts.register("ana", "student", "00" * 16, "11" * 32)
    assert e.value.status == 409
    assert (await session_of(svc, await sign_in(svc, "ANA"))).role == "teacher"
    with pytest.raises(ServiceError) as e:
        await sign_in(svc, "ana", KEY2)
    assert e.value.status == 401
    assert await svc.accounts.find("nobody") is None
    with pytest.raises(ServiceError) as e:
        await svc.accounts.me("not-an-account")
    assert e.value.status == 401


async def test_accounts_need_a_valid_name_role_and_hash(svc):
    for name, role, salt, hash in [
        ("a", "student", "00" * 16, "11" * 32),
        ("ana", "admin", "00" * 16, "11" * 32),
        ("ana", "student", "0", "11" * 32),
        ("ana", "student", "00" * 16, "not hex"),
    ]:
        with pytest.raises(ValueError):
            await svc.accounts.register(name, role, salt, hash)


async def test_sessions(svc):
    s = await session(svc)
    kept = await svc.accounts.put_session(token="t1", uid=s.uid, id="i1", expires=10**15, ip="1.2.3.4")
    assert (await svc.accounts.get_session("t1")).ip == "1.2.3.4"
    assert await svc.accounts.get_session("t2") is None
    await svc.accounts.put_session(token="old", uid=s.uid, id="i2", expires=1)
    assert await svc.accounts.get_session("old") is None  # expired: and removed
    assert {x.token for x in await svc.accounts.sessions_of(s.uid)} >= {kept.token}
    assert await svc.accounts.delete_sessions_of(s.uid) >= 2
    assert await svc.accounts.sessions_of(s.uid) == []
    await svc.accounts.put_session(token="t3", uid=s.uid, id="i3", expires=10**15)
    await svc.accounts.delete_session("t3")
    assert await svc.accounts.get_session("t3") is None


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
    await sign_up(Service(atlas, keys), "taken")
    assert await svc.accounts.taken("taken")
    assert keys.user_id("taken") not in board.users  # checking a name copies nothing here
    with pytest.raises(ServiceError) as e:
        await sign_up(svc, "taken")
    assert e.value.status == 409
    await sign_up(svc, "ana")
    uid = keys.user_id("ana")
    assert not board.users[uid].pending and uid in atlas.users  # confirmed right away
    online["on"] = False
    await sign_up(svc, "offline")
    assert board.users[keys.user_id("offline")].pending  # confirmed at the next sync


async def test_someone_from_another_class_logs_in_and_joins_this_one(keys):
    board, atlas = MemoryRepo(), MemoryRepo()
    await sign_up(Service(atlas, keys), "visitor")
    svc = Service(board, keys, upstream=lambda: atlas)
    assert (await login(svc, "visitor")).username == "visitor"
    assert keys.user_id("visitor") in board.users


async def test_atlas_failing_counts_as_offline(keys):
    class Broken(MemoryRepo):
        async def get_user(self, uid):
            raise OSError("no internet")

    board = MemoryRepo()
    svc = Service(board, keys, upstream=lambda: Broken())
    await sign_up(svc, "ana")
    assert board.users[keys.user_id("ana")].pending
