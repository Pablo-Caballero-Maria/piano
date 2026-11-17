import pytest

from fog.buzzer_queue import BuzzerQueue, QueueError


def test_first_come_first_served_without_a_lesson():
    q = BuzzerQueue()
    assert q.holder is None
    q.join("ana")
    q.join("bob")
    q.join("ana")  # once
    assert q.holder == "ana" and q.waiting == ["ana", "bob"]
    q.leave("ana")
    assert q.holder == "bob"
    q.join("cat")
    q.move("cat", 0)
    assert q.waiting == ["cat", "bob"] and q.holder == "cat"
    q.next()
    assert q.holder == "bob"
    q.remove("bob")
    assert q.holder is None
    with pytest.raises(QueueError):
        q.move("nobody", 0)


def test_a_live_teacher_plays_or_hands_it_over():
    q = BuzzerQueue(waiting=["ana"])
    q.go_live("teach")
    assert q.holder == "teach"  # the queue waits during the lesson
    with pytest.raises(QueueError):
        q.go_live("other")  # one lesson at a time
    with pytest.raises(QueueError):
        q.grant("other", "ana")
    q.grant("teach", "bob")
    assert q.holder == "bob"
    q.revoke("teach")
    assert q.holder == "teach"
    q.grant("teach", "bob")
    q.gone("bob")
    assert q.holder == "teach"
    q.stop_live("teach")
    assert q.holder == "ana" and q.granted is None


def test_the_teacher_leaving_ends_the_lesson():
    q = BuzzerQueue()
    q.go_live("teach")
    q.grant("teach", "bob")
    q.gone("teach")
    assert q.live_teacher is None and q.granted is None and q.holder is None
    with pytest.raises(QueueError):
        q.revoke("teach")
    assert q.snapshot() == {"holder": None, "live": None, "granted": None, "queue": []}
