import pytest

from fog.classroom import Classroom
from pianocore.auth import Session


class Phone:
    def __init__(self, name, role="student"):
        self.session = Session(uid="id-" + name, username=name, role=role)
        self.got: list[dict] = []

    async def send(self, msg):
        self.got.append(msg)

    def last(self, kind):
        return [m for m in self.got if m["t"] == kind][-1]


@pytest.fixture
def room():
    tones = []

    async def tone(freq):
        tones.append(freq)

    r = Classroom(tone=tone, board_status=lambda: {"online": True})
    r.tones = tones
    return r


async def join(room, phone, mode="piano"):
    return await room.join(phone.session, phone.send, mode)


async def test_the_teacher_sees_who_is_here_and_what_they_do(room):
    teacher, ana = Phone("teach", "teacher"), Phone("ana")
    t = await join(room, teacher)
    a = await join(room, ana, "studio")
    assert "people" in teacher.got[0] and "people" not in ana.got[0]
    await room.handle(a, {"t": "activity", "mode": "piano", "notes": [60, 64], "detail": "practising"})
    people = teacher.last("people")["people"]
    assert {p["name"]: (p["mode"], p["notes"], p["detail"]) for p in people}["ana"] == (
        "piano",
        [60, 64],
        "practising",
    )
    await room.leave(a)
    assert [p["name"] for p in teacher.last("people")["people"]] == ["teach"]
    assert t.id in room.members


async def test_a_lesson_reaches_every_student_and_the_buzzer(room):
    teacher, ana, bob = Phone("teach", "teacher"), Phone("ana"), Phone("bob")
    t, a = await join(room, teacher), await join(room, ana)
    await join(room, bob)
    await room.handle(a, {"t": "live", "on": True})
    assert ana.last("error")["message"] == "Only a teacher can do that"
    await room.handle(t, {"t": "live", "on": True, "mode": "piano"})
    assert bob.last("lesson") == {"t": "lesson", "live": "teach", "mode": "piano"}
    await room.handle(t, {"t": "note", "freq": 440, "midi": [69]})
    assert room.tones[-1] == 440 and bob.last("teacher.note") == {
        "t": "teacher.note",
        "freq": 440,
        "midi": [69],
    }
    await room.handle(a, {"t": "note", "freq": 262, "midi": [60]})  # ana doesn't hold the buzzer
    assert room.tones[-1] == 440
    # The teacher hands the buzzer to ana, then takes it back
    await room.handle(t, {"t": "queue.grant", "user": "ana"})
    assert bob.last("buzzer")["holder"] == "ana" and room.tones[-1] == 0
    await room.handle(a, {"t": "note", "freq": 262, "midi": [60]})
    assert room.tones[-1] == 262
    await room.handle(t, {"t": "queue.revoke"})
    assert bob.last("buzzer")["holder"] == "teach"
    # Studio lessons: late joiners get the piano roll
    await room.handle(t, {"t": "live", "on": True, "mode": "studio"})
    await room.handle(t, {"t": "studio", "melody": {"name": "Ode"}, "playhead": 2, "playing": True})
    assert ana.last("teacher.studio")["melody"] == {"name": "Ode"}
    cat = Phone("cat")
    await join(room, cat)
    assert cat.got[0]["studio"]["playhead"] == 2 and cat.got[0]["lesson"]["mode"] == "studio"
    await room.handle(t, {"t": "live", "on": False})
    assert ana.last("lesson")["live"] is None and room.studio is None


async def test_the_queue_without_a_lesson(room):
    teacher, ana, bob = Phone("teach", "teacher"), Phone("ana"), Phone("bob")
    t, a, b = await join(room, teacher), await join(room, ana), await join(room, bob)
    await room.handle(a, {"t": "queue.join"})
    await room.handle(b, {"t": "queue.join"})
    assert bob.last("buzzer")["holder"] == "ana" and bob.last("buzzer")["queue"] == ["ana", "bob"]
    await room.handle(b, {"t": "note", "freq": 300, "midi": [62]})
    assert 300 not in room.tones
    await room.handle(b, {"t": "queue.next"})
    assert bob.last("error")["message"] == "Only a teacher can do that"
    await room.handle(t, {"t": "queue.move", "user": "bob", "to": 0})
    assert ana.last("buzzer")["holder"] == "bob"
    await room.handle(b, {"t": "note", "freq": 300, "midi": [62]})
    assert room.tones[-1] == 300
    await room.leave(b)  # disconnecting gives it up, and silences it
    assert ana.last("buzzer")["holder"] == "ana" and room.tones[-1] == 0
    await room.handle(t, {"t": "queue.remove", "user": "ana"})
    assert teacher.last("buzzer")["holder"] is None
    await room.handle(t, {"t": "queue.grant", "user": "ana"})
    assert teacher.last("error")["message"].startswith("Start the lesson")
    await room.handle(t, {"t": "bogus"})
    assert "Unknown" in teacher.last("error")["message"]


async def test_the_live_teacher_leaving_ends_the_lesson(room):
    teacher, ana = Phone("teach", "teacher"), Phone("ana")
    t = await join(room, teacher)
    await join(room, ana)
    await room.handle(t, {"t": "live", "on": True})
    await room.leave(t)
    assert ana.last("lesson")["live"] is None and ana.last("buzzer")["holder"] is None


async def test_lessons_are_relayed_to_students_at_home(room):
    class Bridge:
        def __init__(self):
            self.events = []

        def publish(self, teacher, name, data):
            self.events.append((teacher, name, data))

        def followers(self, teacher):
            return [{"id": "ably:zoe", "name": "zoe", "role": "student", "remote": True}]

    room.bridge = Bridge()
    teacher = Phone("teach", "teacher")
    t = await join(room, teacher)
    await room.handle(t, {"t": "live", "on": True})
    await room.handle(t, {"t": "note", "freq": 440, "midi": [69]})
    assert room.bridge.events == [
        ("teach", "lesson", {"live": True, "mode": "piano"}),
        ("teach", "note", {"freq": 440, "midi": [69]}),
    ]
    assert "zoe" in [p["name"] for p in teacher.last("people")["people"]]
