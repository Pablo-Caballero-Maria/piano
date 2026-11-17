import pytest

import fog.board
from fog.board import BoardLink, BoardOffline
from fog.simboard import SimulatedBoard as LoopbackBoard
from pianocore.kv_repo import KVRepo
from tests.core.test_repos import check_repo_contract


@pytest.fixture
def board(tmp_path):
    b = LoopbackBoard(tmp_path)
    yield b
    b.close()


async def test_records_on_the_real_board_storage_code(board, keys):
    """The whole repository contract, through the MQTT protocol, against esp32/kv.py."""
    await check_repo_contract(KVRepo(board.link, keys))


async def test_paging_of_keys_and_values(board, monkeypatch):
    import kv

    monkeypatch.setattr(kv, "MAX_ANSWER", 64)  # tiny answers: several round trips
    link = board.link
    for i in range(30):
        await link.put(f"o/x/{i:02}", b"v" * 10)
    keys = await link.keys("o/x/")
    assert keys == [f"o/x/{i:02}" for i in range(30)]
    values = await link.get_many([*keys, "missing"])
    assert len(values) == 30 and values["o/x/07"] == b"v" * 10
    assert await link.free() > 0


async def test_tone_and_status(board):
    await board.link.tone(440)
    await board.link.tone(0)
    assert board.tones == [440, 0]
    seen = []
    board.link.listeners.append(lambda s: seen.append(s["online"]))
    await board.link.handle_message(board.link.topic("status"), b'{"online": false}')
    assert seen == [False] and not board.link.online
    with pytest.raises(BoardOffline):
        await board.link.get("u/x")


async def test_a_silent_board_times_out(tmp_path, monkeypatch):
    monkeypatch.setattr(fog.board, "TIMEOUT_S", 0.05)
    b = LoopbackBoard(tmp_path, answer=False)
    try:
        with pytest.raises(BoardOffline):
            await b.link.get("u/x")
        assert len([t for t, _ in b.sent if t.endswith("kv/req")]) == fog.board.RETRIES + 1
    finally:
        b.close()


async def test_no_broker_means_offline():
    link = BoardLink("t1")
    assert not link.online
    with pytest.raises(BoardOffline):
        await link.get("x")
    await link.tone(440)  # silently dropped
