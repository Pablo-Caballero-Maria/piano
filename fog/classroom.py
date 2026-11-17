"""The live class on the teacher's PC: everyone connected to it is in the class.

Each phone keeps a WebSocket open (:mod:`fog.app`) and exchanges JSON messages ``{"t": type, …}``.

From phones:

====================  =========  =====================================================
``activity``          anyone     what I'm doing: {mode: piano|studio, notes: [midi], detail}
``note``              anyone     what I'm playing: {freq, midi}. Reaches the buzzer only if
                                 I hold it; a live teacher's notes also go to every student
``live``              teacher    {on, mode}: start / stop giving the lesson
``studio``            teacher    {melody, playhead, playing}: the lesson's piano roll
``queue.join``        anyone     ask for the buzzer (``queue.leave``: give it up)
``queue.grant``       teacher    {user}: hand the buzzer to a student (while live)
``queue.revoke``      teacher    take it back
``queue.remove``      teacher    {user}; ``queue.move`` {user, to}; ``queue.next``
====================  =========  =====================================================

To phones: ``welcome`` (everything, on joining), ``people`` (teachers only: who is here and what
they're doing), ``lesson`` (who is live, in which mode), ``teacher.note`` / ``teacher.studio`` (what
the live teacher plays), ``buzzer`` (who holds it, the queue), ``board`` (is it online), ``error``.

Students at home following this lesson through Ably appear in the teachers' list (remote).
"""

from __future__ import annotations

import asyncio
import itertools
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from pianocore.auth import Session

from .buzzer_queue import BuzzerQueue, QueueError

log = logging.getLogger(__name__)
Send = Callable[[dict[str, Any]], Awaitable[None]]
MODES = ("piano", "studio")


@dataclass
class Member:
    id: int
    session: Session
    send: Send
    mode: str = "piano"
    notes: list[int] = field(default_factory=list)
    detail: str = ""
    since: float = field(default_factory=time.time)

    @property
    def name(self) -> str:
        return self.session.username

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "role": self.session.role,
            "mode": self.mode,
            "notes": self.notes,
            "detail": self.detail,
            "since": int(self.since),
            "remote": False,
        }


class Classroom:
    def __init__(
        self,
        tone: Callable[[int], Awaitable[None]],
        board_status: Callable[[], dict[str, Any]],
        bridge: Any = None,
    ) -> None:
        """tone(freq) plays on the board; bridge (fog.ably_bridge.AblyBridge or None) relays the
        lesson to students at home."""
        self._tone = tone
        self._board_status = board_status
        self.bridge = bridge
        self.members: dict[int, Member] = {}
        self.queue = BuzzerQueue()
        self.lesson_mode = "piano"
        self.studio: dict[str, Any] | None = None  # the live teacher's piano roll, for late joiners
        self._ids = itertools.count(1)

    # ---- Sending
    async def _deliver(self, member: Member, msg: dict[str, Any]) -> None:
        try:
            await asyncio.wait_for(member.send(msg), 5)
        except Exception as e:  # closed or stuck socket: it gets removed when its loop ends
            log.debug("send to %s failed: %r", member.name, e)

    async def _to(self, members: list[Member], msg: dict[str, Any]) -> None:
        await asyncio.gather(*(self._deliver(m, msg) for m in members))

    def _everyone(self, but: Member | None = None) -> list[Member]:
        return [m for m in self.members.values() if m is not but]

    def _teachers(self) -> list[Member]:
        return [m for m in self.members.values() if m.session.is_teacher]

    def _connected(self, name: str) -> bool:
        return any(m.name == name for m in self.members.values())

    # ---- State for phones
    async def people(self) -> list[dict[str, Any]]:
        out = [m.public() for m in self.members.values()]
        live = self.queue.live_teacher
        if self.bridge is not None and live:
            out += self.bridge.followers(live)  # cached: the bridge polls Ably
        return out

    def lesson(self) -> dict[str, Any]:
        return {"t": "lesson", "live": self.queue.live_teacher, "mode": self.lesson_mode}

    def buzzer(self) -> dict[str, Any]:
        return {"t": "buzzer", **self.queue.snapshot()}

    def board(self) -> dict[str, Any]:
        return {"t": "board", **self._board_status()}

    async def _people_changed(self) -> None:
        teachers = self._teachers()
        if teachers:
            await self._to(teachers, {"t": "people", "people": await self.people()})

    async def board_changed(self) -> None:
        await self._to(self._everyone(), self.board())

    async def _buzzer_changed(self, holder_before: str | None) -> None:
        if self.queue.holder != holder_before:
            await self._tone(0)  # never leave the last holder's note hanging
        await self._to(self._everyone(), self.buzzer())

    # ---- Joining and leaving
    async def join(self, session: Session, send: Send, mode: str = "piano") -> Member:
        member = Member(
            id=next(self._ids), session=session, send=send, mode=mode if mode in MODES else "piano"
        )
        self.members[member.id] = member
        welcome = {
            "t": "welcome",
            "you": member.public(),
            "lesson": self.lesson(),
            "buzzer": self.buzzer(),
            "board": self.board(),
            "studio": self.studio,
        }
        if session.is_teacher:
            welcome["people"] = await self.people()
        await self._deliver(member, welcome)
        await self._people_changed()
        log.info("%s (%s) joined the class", member.name, session.role)
        return member

    async def leave(self, member: Member) -> None:
        if self.members.pop(member.id, None) is None:
            return
        log.info("%s left the class", member.name)
        if not self._connected(member.name):  # their last tab
            before = self.queue.holder
            was_live = self.queue.live_teacher == member.name
            self.queue.gone(member.name)
            if was_live:
                self._end_lesson(member.name)
                await self._to(self._everyone(), self.lesson())
            await self._buzzer_changed(before)
        await self._people_changed()

    # ---- Messages
    async def handle(self, member: Member, msg: dict[str, Any]) -> None:
        kind = msg.get("t")
        try:
            if kind == "activity":
                await self._activity(member, msg)
            elif kind == "note":
                await self._note(member, msg)
            elif kind == "live":
                await self._live(member, msg)
            elif kind == "studio":
                await self._studio(member, msg)
            elif isinstance(kind, str) and kind.startswith("queue."):
                await self._queue(member, kind[6:], msg)
            else:
                raise QueueError(f"Unknown message {kind!r}")
        except QueueError as e:
            await self._deliver(member, {"t": "error", "message": str(e)})

    async def _activity(self, member: Member, msg: dict[str, Any]) -> None:
        if msg.get("mode") in MODES:
            member.mode = msg["mode"]
        if isinstance(msg.get("notes"), list):
            member.notes = [int(n) for n in msg["notes"][:16] if isinstance(n, int | float)]
        if isinstance(msg.get("detail"), str):
            member.detail = msg["detail"][:120]
        await self._people_changed()

    async def _note(self, member: Member, msg: dict[str, Any]) -> None:
        freq = msg.get("freq", 0)
        freq = int(freq) if isinstance(freq, int | float) and 0 <= freq <= 20000 else 0
        midi = [int(n) for n in msg.get("midi", [])[:16] if isinstance(n, int | float)]
        if self.queue.holder == member.name:
            await self._tone(freq)
        if self.queue.live_teacher == member.name:
            note = {"t": "teacher.note", "freq": freq, "midi": midi}
            await self._to(self._everyone(but=member), note)
            if self.bridge is not None:
                self.bridge.publish(member.name, "note", {"freq": freq, "midi": midi})
        member.notes = midi
        await self._people_changed()

    def _teacher(self, member: Member) -> None:
        if not member.session.is_teacher:
            raise QueueError("Only a teacher can do that")

    async def _live(self, member: Member, msg: dict[str, Any]) -> None:
        self._teacher(member)
        before = self.queue.holder
        if msg.get("on"):
            self.queue.go_live(member.name)
            self.lesson_mode = msg.get("mode") if msg.get("mode") in MODES else "piano"
            if self.lesson_mode != "studio":
                self.studio = None
            if self.bridge is not None:
                self.bridge.publish(member.name, "lesson", {"live": True, "mode": self.lesson_mode})
        elif self.queue.live_teacher == member.name:
            self.queue.stop_live(member.name)
            self._end_lesson(member.name)
        await self._to(self._everyone(), self.lesson())
        await self._buzzer_changed(before)

    def _end_lesson(self, teacher: str) -> None:
        self.studio = None
        if self.bridge is not None:
            self.bridge.publish(teacher, "lesson", {"live": False})

    async def _studio(self, member: Member, msg: dict[str, Any]) -> None:
        if self.queue.live_teacher != member.name:
            raise QueueError("Start the lesson (go live) to share your piano roll")
        self.studio = {k: msg.get(k) for k in ("melody", "playhead", "playing")}
        await self._to(self._everyone(but=member), {"t": "teacher.studio", **self.studio})
        if self.bridge is not None:
            self.bridge.publish(member.name, "studio", self.studio)

    async def _queue(self, member: Member, action: str, msg: dict[str, Any]) -> None:
        before = self.queue.holder
        q = self.queue
        if action == "join":
            q.join(member.name)
        elif action == "leave":
            q.leave(member.name)
        else:
            self._teacher(member)
            user = msg.get("user")
            if action == "grant":
                if not isinstance(user, str) or not self._connected(user):
                    raise QueueError("That student isn't connected")
                q.grant(member.name, user)
            elif action == "revoke":
                q.revoke(member.name)
            elif action == "remove":
                q.remove(str(user))
            elif action == "move":
                q.move(str(user), int(msg.get("to", 0)))
            elif action == "next":
                q.next()
            else:
                raise QueueError(f"Unknown queue action {action!r}")
        await self._buzzer_changed(before)
