"""Users, melodies and sign-in sessions, and the validation of what clients send.

A *user* is a teacher or a student. A *melody* belongs to its owner and is either private (only
the owner sees it) or public (everyone sees and can edit it; only the owner can delete it or
change its visibility). Records are never removed outright: a deleted melody becomes a
tombstone (``deleted=True``) so that the deletion reaches the other copies when they sync.

Times are milliseconds since the epoch (``updated`` decides which copy wins in a sync).

Accounts are Better Auth's (web/server/auth): its store keeps them here, through
:mod:`pianocore.accounts_api`, as the same :class:`User` records as before, and its sessions as
:class:`AuthSession` records.
"""

from __future__ import annotations

import re
import time
from dataclasses import asdict, dataclass, fields
from typing import Any, Self

ROLES = ("teacher", "student")
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")
SALT_RE = re.compile(r"^[0-9a-f]{32}$")
HASH_RE = re.compile(r"^[0-9a-f]{64}$")
NOTE_RE = re.compile(r"^\d{1,3}:\d+(\.\d+)?:\d+(\.\d+)?$")
MAX_NAME = 80
MAX_NOTES_TEXT = 14000  # ~1000 notes: fits one value of the board's store once encrypted
BPM_RANGE = (20, 400)


class Invalid(ValueError):
    """Something a client sent breaks the rules (the message is shown to the user)."""


def now_ms() -> int:
    return int(time.time() * 1000)


class _Record:
    """Conversion to and from the plain dicts that get sealed and stored."""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)  # type: ignore[call-overload]

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Self:
        names = {f.name for f in fields(cls)}  # type: ignore[arg-type]
        return cls(**{k: v for k, v in d.items() if k in names})


@dataclass
class User(_Record):
    uid: str  # keyed hash of the lowercase username (crypto.Keys.user_id)
    username: str  # as typed at sign-up
    role: str  # "teacher" or "student"
    salt: str  # 32 hex digits
    # 64 hex digits, sha256(salt + password key) — computed by Better Auth's password hasher
    # (web/server/auth/password.ts); the password key itself is never stored
    hash: str
    created: int
    updated: int
    pending: bool = False  # signed up while the PC was offline: not yet checked against Atlas
    notice: str = ""  # shown once at the next login (e.g. "your username was taken, now ...")
    deleted: bool = False

    def public(self) -> dict[str, str]:
        return {"username": self.username, "role": self.role}


@dataclass
class Melody(_Record):
    id: str  # 32 hex digits
    owner: str  # the owner's uid
    owner_name: str
    name: str
    bpm: float
    notes: str  # "p:s:d p:s:d …" (MIDI note, start and duration in beats)
    length: float  # beats
    public: bool
    created: int
    updated: int
    edited_by: str  # username of whoever saved it last
    deleted: bool = False

    def note_count(self) -> int:
        return len(self.notes.split()) if self.notes else 0

    def summary(self) -> dict[str, Any]:
        """What melody lists show (no notes)."""
        return {
            "id": self.id,
            "name": self.name,
            "bpm": self.bpm,
            "noteCount": self.note_count(),
            "length": self.length,
            "public": self.public,
            "owner": self.owner_name,
            "editedBy": self.edited_by,
            "createdAt": self.created,
            "updatedAt": self.updated,
        }

    def full(self) -> dict[str, Any]:
        return {**self.summary(), "notes": self.notes}


def check_username(name: Any) -> str:
    if not isinstance(name, str) or not USERNAME_RE.match(name):
        raise Invalid("The username must be 3-32 letters, digits, _ . or -")
    return name


def check_role(role: Any) -> str:
    if role not in ROLES:
        raise Invalid("Choose teacher or student")
    return role


def check_password_hash(salt: Any, hash: Any) -> tuple[str, str]:
    """A password hash from Better Auth's hasher: a 16-byte salt and a SHA-256, in hex."""
    if not (isinstance(salt, str) and SALT_RE.match(salt) and isinstance(hash, str) and HASH_RE.match(hash)):
        raise Invalid("Bad password hash")
    return salt, hash


@dataclass
class AuthSession(_Record):
    """A Better Auth sign-in session, kept by the server that created it (it isn't synced)."""

    sid: str  # session_id(token): where it's stored (the token itself only inside the sealed record)
    id: str  # Better Auth's id
    token: str
    uid: str
    expires: int
    created: int
    updated: int
    ip: str = ""
    agent: str = ""

    def expired(self, now: int | None = None) -> bool:
        return self.expires <= (now if now is not None else now_ms())


@dataclass
class MelodyInput:
    name: str
    bpm: float
    notes: str
    length: float
    public: bool


def check_melody(d: Any) -> MelodyInput:
    """Validate a melody sent by a client (create or update)."""
    if not isinstance(d, dict):
        raise Invalid("Missing melody")
    name = " ".join(str(d.get("name", "")).split())
    if not 1 <= len(name) <= MAX_NAME:
        raise Invalid(f"The name must be 1-{MAX_NAME} characters")
    bpm = d.get("bpm")
    if isinstance(bpm, bool) or not isinstance(bpm, int | float) or not BPM_RANGE[0] <= bpm <= BPM_RANGE[1]:
        raise Invalid(f"The tempo must be {BPM_RANGE[0]}-{BPM_RANGE[1]} BPM")
    notes = d.get("notes")
    if not isinstance(notes, str) or len(notes) > MAX_NOTES_TEXT:
        raise Invalid("Too many notes (max about 1000)")
    tokens = notes.split()
    if any(not NOTE_RE.match(t) or int(t.split(":")[0]) > 127 for t in tokens):
        raise Invalid("Bad notes")
    length = d.get("length", 0)
    if isinstance(length, bool) or not isinstance(length, int | float) or length < 0:
        length = 0
    return MelodyInput(
        name=name, bpm=bpm, notes=" ".join(tokens), length=length, public=bool(d.get("public"))
    )
