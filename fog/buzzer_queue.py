"""Who plays on the classroom's buzzer (it can only sound one note at a time).

- While a teacher is *live* (broadcasting the lesson), the buzzer plays the teacher, unless the
  teacher hands it to a student (``grant``) — and can take it back (``revoke``).
- Otherwise anyone can ask for it: people wait in a queue and the first one plays, first come
  first served. Teachers administer the queue: move people, remove them, skip to the next.

Pure state, no I/O: :mod:`fog.classroom` applies it and tells everyone what changed.
"""

from __future__ import annotations

from dataclasses import dataclass, field


class QueueError(Exception):
    """An action the rules don't allow (the message is shown to whoever tried)."""


@dataclass
class BuzzerQueue:
    live_teacher: str | None = None  # the teacher broadcasting right now
    granted: str | None = None  # the student a live teacher handed the buzzer to
    waiting: list[str] = field(default_factory=list)  # first = plays when no teacher is live

    @property
    def holder(self) -> str | None:
        """Whose notes reach the buzzer now."""
        if self.live_teacher is not None:
            return self.granted or self.live_teacher
        return self.waiting[0] if self.waiting else None

    def snapshot(self) -> dict:
        return {
            "holder": self.holder,
            "live": self.live_teacher,
            "granted": self.granted,
            "queue": list(self.waiting),
        }

    # ---- Everyone
    def join(self, name: str) -> None:
        if name not in self.waiting:
            self.waiting.append(name)

    def leave(self, name: str) -> None:
        """Leave the queue (or give back the buzzer)."""
        if name in self.waiting:
            self.waiting.remove(name)

    def gone(self, name: str) -> None:
        """Someone disconnected: out of the queue, the grant and the broadcast."""
        self.leave(name)
        if self.granted == name:
            self.granted = None
        if self.live_teacher == name:
            self.live_teacher = None
            self.granted = None

    # ---- Teachers
    def go_live(self, teacher: str) -> None:
        if self.live_teacher not in (None, teacher):
            raise QueueError(f"{self.live_teacher} is already giving the lesson")
        self.live_teacher = teacher

    def stop_live(self, teacher: str) -> None:
        if self.live_teacher == teacher:
            self.live_teacher = None
            self.granted = None

    def grant(self, teacher: str, student: str) -> None:
        """A live teacher hands the buzzer to a student."""
        if self.live_teacher != teacher:
            raise QueueError("Start the lesson (go live) to hand the buzzer to someone")
        self.granted = student

    def revoke(self, teacher: str) -> None:
        if self.live_teacher != teacher:
            raise QueueError("Only the teacher giving the lesson can take the buzzer back")
        self.granted = None

    def remove(self, name: str) -> None:
        self.leave(name)

    def move(self, name: str, index: int) -> None:
        if name not in self.waiting:
            raise QueueError(f"{name} isn't waiting")
        self.waiting.remove(name)
        self.waiting.insert(max(0, min(index, len(self.waiting))), name)

    def next(self) -> None:
        """The one playing goes out; the next one in the queue plays."""
        if self.waiting:
            self.waiting.pop(0)
