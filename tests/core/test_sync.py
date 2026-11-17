import pytest

from pianocore.auth import read_token
from pianocore.models import now_ms
from pianocore.repo import MemoryRepo
from pianocore.service import Service
from pianocore.sync import sync

KEY, KEY2 = "ab" * 32, "cd" * 32
TUNE = {"name": "Tune", "bpm": 120, "notes": "60:0:1", "length": 1}


@pytest.fixture
def world(keys):
    """A classroom board, Atlas, and the services on each side (the PC offline)."""
    board, atlas = MemoryRepo(), MemoryRepo()
    return board, atlas, Service(board, keys, upstream=lambda: None), Service(atlas, keys)


async def login(svc, name, key=KEY, role="student"):
    try:
        reply = await svc.login(name, key)
    except Exception:
        reply = await svc.register(name, role, key)
    return read_token(svc.keys, reply["token"])


async def test_both_ways_newest_wins(world, keys):
    board, atlas, here, cloud = world
    ana_here = await login(here, "ana")
    m = await here.create_melody(ana_here, TUNE)
    report = await sync(board, atlas, keys)
    assert (report.users_up, report.melodies_up) == (1, 1)
    assert not board.users[keys.user_id("ana")].pending
    # Edited at home (Vercel), then here later: here wins; the next sync takes it up
    ana_cloud = await login(cloud, "ana")
    await cloud.update_melody(ana_cloud, m["id"], {**TUNE, "name": "At home"})
    report = await sync(board, atlas, keys)
    assert report.melodies_down == 1 and board.melodies[m["id"]].name == "At home"
    await here.update_melody(ana_here, m["id"], {**TUNE, "name": "In class"})
    await sync(board, atlas, keys)
    assert atlas.melodies[m["id"]].name == "In class" and atlas.melodies[m["id"]].edited_by == "ana"
    # Nothing new: nothing moves
    report = await sync(board, atlas, keys)
    assert (report.melodies_up, report.melodies_down, report.users_up) == (0, 0, 0)


async def test_deletions_travel(world, keys):
    board, atlas, here, cloud = world
    ana = await login(here, "ana")
    m = await here.create_melody(ana, TUNE)
    await sync(board, atlas, keys)
    await cloud.delete_melody(await login(cloud, "ana"), m["id"])
    await sync(board, atlas, keys)
    assert board.melodies[m["id"]].deleted
    assert await here.list_melodies(ana, "mine") == []


async def test_public_melodies_of_other_classes_come_down_while_they_fit(world, keys):
    board, atlas, here, cloud = world
    await login(here, "ana")
    carol = await login(cloud, "carol")
    shared = await cloud.create_melody(carol, {**TUNE, "public": True})
    private = await cloud.create_melody(carol, TUNE)
    await sync(board, atlas, keys)
    assert shared["id"] in board.melodies and private["id"] not in board.melodies
    # Made private by its owner: the board's copy goes away
    await cloud.update_melody(carol, shared["id"], {**TUNE, "public": False})
    report = await sync(board, atlas, keys)
    assert shared["id"] not in board.melodies and report.dropped == 1
    # A full board skips other classes' public melodies
    board.capacity = 1000
    await cloud.create_melody(carol, {**TUNE, "name": "Big", "public": True})
    report = await sync(board, atlas, keys)
    assert report.skipped_no_room == 1


async def test_a_name_taken_while_offline_is_renamed(world, keys):
    board, atlas, here, cloud = world
    await cloud.register("ana", "teacher", KEY2)  # someone in another class
    ana = await login(here, "ana")  # PC offline: pending
    m = await here.create_melody(ana, TUNE)
    report = await sync(board, atlas, keys)
    assert report.renamed == [("ana", "ana-2")]
    new_uid = keys.user_id("ana-2")
    assert board.melodies[m["id"]].owner == new_uid and atlas.melodies[m["id"]].owner_name == "ana-2"
    # The old name and password still log in, here and at home, and the user is told once
    reply = await here.login("ana", KEY)
    assert reply["user"]["username"] == "ana-2" and "already taken" in reply["notice"]
    assert (await here.login("ana", KEY))["notice"] == ""
    assert (await cloud.login("ana", KEY))["user"]["username"] == "ana-2"
    assert (await cloud.login("ana", KEY2))["user"]["username"] == "ana"  # the other person is untouched


async def test_old_tombstones_are_purged_from_the_board(world, keys):
    board, atlas, here, _ = world
    ana = await login(here, "ana")
    m = await here.create_melody(ana, TUNE)
    await here.delete_melody(ana, m["id"])
    board.melodies[m["id"]].updated = now_ms() - 40 * 24 * 3600 * 1000
    atlas.melodies[m["id"]] = board.melodies[m["id"]]
    report = await sync(board, atlas, keys)
    assert report.purged == 1 and m["id"] not in board.melodies
