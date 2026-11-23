"""Where users, melodies and sign-in sessions live: the interface every store implements.

Three implementations:

- :class:`MemoryRepo` (here) — for tests;
- :class:`pianocore.kv_repo.KVRepo` — a classroom board's flash, reached over MQTT by the PC;
- :class:`pianocore.mongo_repo.MongoRepo` — MongoDB Atlas (Vercel, and the PC when it syncs).

Repositories store records as they are given (``updated`` included); the rules (who may do what,
timestamps) live in :mod:`pianocore.service` and :mod:`pianocore.accounts`. Lookups by default
skip tombstones; the sync asks for them with ``with_deleted=True``. Sessions belong to the store of
the server that created them: the sync never copies them.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Iterable
from typing import Any

from .models import AuthSession, Melody, User


class Repo(ABC):
    @abstractmethod
    async def get_user(self, uid: str) -> User | None: ...

    async def get_users(self, uids: Iterable[str]) -> dict[str, User]:
        out = {}
        for uid in uids:
            user = await self.get_user(uid)
            if user is not None:
                out[uid] = user
        return out

    @abstractmethod
    async def put_user(self, user: User) -> None: ...

    @abstractmethod
    async def delete_user(self, uid: str) -> None:
        """Remove a user record outright (used when a sync renames an account)."""

    @abstractmethod
    async def all_users(self) -> list[User]:
        """Every user record (tombstones included). Used on a board: its class's accounts."""

    @abstractmethod
    async def get_melody(self, mid: str) -> Melody | None: ...

    async def get_melodies(self, mids: Iterable[str]) -> dict[str, Melody]:
        out = {}
        for mid in mids:
            m = await self.get_melody(mid)
            if m is not None:
                out[mid] = m
        return out

    @abstractmethod
    async def put_melody(self, melody: Melody) -> None: ...

    @abstractmethod
    async def drop_melody(self, mid: str) -> None:
        """Remove a melody record outright (a board's copy of someone else's public melody)."""

    @abstractmethod
    async def find_melodies(
        self, *, owners: Iterable[str] = (), public: bool = False, since: int = 0, with_deleted: bool = False
    ) -> list[Melody]:
        """Melodies owned by one of ``owners``, plus the public ones if ``public``, changed at or after
        ``since`` (a sync may see a record twice, which is harmless, but must never miss one)."""

    @abstractmethod
    async def get_alias(self, uid: str) -> str | None:
        """The new id of an account renamed by a sync (its old name still logs in), or None."""

    @abstractmethod
    async def put_alias(self, old_uid: str, new_uid: str) -> None: ...

    @abstractmethod
    async def get_meta(self, name: str) -> dict[str, Any]:
        """Bookkeeping (e.g. the last sync time); {} if unset."""

    @abstractmethod
    async def put_meta(self, name: str, value: dict[str, Any]) -> None: ...

    @abstractmethod
    async def get_session(self, sid: str) -> AuthSession | None: ...

    @abstractmethod
    async def put_session(self, session: AuthSession) -> None: ...

    @abstractmethod
    async def delete_session(self, sid: str) -> None: ...

    @abstractmethod
    async def sessions_of(self, uid: str) -> list[AuthSession]:
        """Every session of an account (expired ones included)."""

    async def free_bytes(self) -> int | None:
        """Space left, for stores that can fill up (a board's flash); None if unlimited."""
        return None


def matches(m: Melody, owners: set[str], public: bool, since: int, with_deleted: bool) -> bool:
    """The filter of :meth:`Repo.find_melodies`, for stores that filter in Python."""
    if m.updated < since or (m.deleted and not with_deleted):
        return False
    return m.owner in owners or (public and m.public)


class MemoryRepo(Repo):
    """Everything in dicts. For tests (and a reference for the other stores)."""

    def __init__(self) -> None:
        self.users: dict[str, User] = {}
        self.melodies: dict[str, Melody] = {}
        self.aliases: dict[str, str] = {}
        self.meta: dict[str, dict[str, Any]] = {}
        self.sessions: dict[str, AuthSession] = {}
        self.capacity: int | None = None  # set in tests to act like a full board

    async def get_user(self, uid: str) -> User | None:
        u = self.users.get(uid)
        return User.from_dict(u.to_dict()) if u else None

    async def put_user(self, user: User) -> None:
        self.users[user.uid] = User.from_dict(user.to_dict())

    async def delete_user(self, uid: str) -> None:
        self.users.pop(uid, None)

    async def all_users(self) -> list[User]:
        return [User.from_dict(u.to_dict()) for u in self.users.values()]

    async def get_melody(self, mid: str) -> Melody | None:
        m = self.melodies.get(mid)
        return Melody.from_dict(m.to_dict()) if m else None

    async def put_melody(self, melody: Melody) -> None:
        self.melodies[melody.id] = Melody.from_dict(melody.to_dict())

    async def drop_melody(self, mid: str) -> None:
        self.melodies.pop(mid, None)

    async def find_melodies(
        self, *, owners: Iterable[str] = (), public: bool = False, since: int = 0, with_deleted: bool = False
    ) -> list[Melody]:
        owner_set = set(owners)
        return [
            Melody.from_dict(m.to_dict())
            for m in self.melodies.values()
            if matches(m, owner_set, public, since, with_deleted)
        ]

    async def get_alias(self, uid: str) -> str | None:
        return self.aliases.get(uid)

    async def put_alias(self, old_uid: str, new_uid: str) -> None:
        self.aliases[old_uid] = new_uid

    async def get_meta(self, name: str) -> dict[str, Any]:
        return dict(self.meta.get(name, {}))

    async def put_meta(self, name: str, value: dict[str, Any]) -> None:
        self.meta[name] = dict(value)

    async def get_session(self, sid: str) -> AuthSession | None:
        s = self.sessions.get(sid)
        return AuthSession.from_dict(s.to_dict()) if s else None

    async def put_session(self, session: AuthSession) -> None:
        self.sessions[session.sid] = AuthSession.from_dict(session.to_dict())

    async def delete_session(self, sid: str) -> None:
        self.sessions.pop(sid, None)

    async def sessions_of(self, uid: str) -> list[AuthSession]:
        return [AuthSession.from_dict(s.to_dict()) for s in self.sessions.values() if s.uid == uid]

    async def free_bytes(self) -> int | None:
        return self.capacity
