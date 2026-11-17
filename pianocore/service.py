"""Accounts and melodies: the rules both servers apply.

``repo`` is where the records live: a classroom board on the teacher's PC, or Atlas on Vercel.
On the teacher's PC, ``upstream()`` returns Atlas while the PC has internet (else None):

- sign-ups are checked against Atlas, because usernames are unique system-wide; without
  internet the account is created *pending*, and the next sync confirms it (or renames it if the
  name was taken meanwhile, see :mod:`pianocore.sync`);
- people from other classes can log in: their account is copied to the board, so they become
  part of this class.

Melodies: the owner sees and edits theirs; public ones can be seen and edited by everyone, but
only the owner can delete them or change their visibility. Deleting leaves a tombstone.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from .auth import Session, key_hash, make_token, new_salt, password_ok
from .crypto import Keys
from .models import Melody, User, check_key, check_melody, check_role, check_username, now_ms
from .repo import Repo

log = logging.getLogger(__name__)
RESERVE_BYTES = 64 * 1024  # keep this much of a board's flash free


class ServiceError(Exception):
    """A request the rules refuse: an HTTP-like status and a message for the user."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


class Service:
    def __init__(
        self,
        repo: Repo,
        keys: Keys,
        upstream: Callable[[], Repo | None] | None = None,
        on_change: Callable[[], Awaitable[None] | None] | None = None,
    ) -> None:
        self.repo = repo
        self.keys = keys
        self._upstream = upstream
        self._on_change = on_change

    # ---- helpers
    async def _call_upstream(self, fn: Callable[[Repo], Awaitable[Any]]) -> tuple[bool, Any]:
        """Run fn(Atlas) if the PC is online. Returns (reached Atlas?, result)."""
        repo = self._upstream() if self._upstream else None
        if repo is None:
            return False, None
        try:
            return True, await fn(repo)
        except Exception as e:  # no internet after all, DNS, timeout…: work locally
            log.warning("Atlas unreachable: %r", e)
            return False, None

    async def _changed(self) -> None:
        if self._on_change:
            result = self._on_change()
            if result is not None:
                await result

    def _session_reply(self, user: User) -> dict[str, Any]:
        return {"token": make_token(self.keys, user), "user": user.public(), "notice": user.notice}

    # ---- accounts
    async def register(self, username: Any, role: Any, key: Any) -> dict[str, Any]:
        name, role, key = check_username(username), check_role(role), check_key(key)
        uid = self.keys.user_id(name)
        existing = await self.repo.get_user(uid)
        if existing and not existing.deleted:
            raise ServiceError(409, "That username is already taken")
        reached, remote = await self._call_upstream(lambda r: r.get_user(uid))
        if remote and not remote.deleted:
            raise ServiceError(409, "That username is already taken")
        now = now_ms()
        salt = new_salt()
        user = User(
            uid=uid, username=name, role=role, salt=salt, hash=key_hash(salt, key), created=now, updated=now
        )
        if self._upstream is not None:  # a classroom board: confirm in Atlas now, or at the next sync
            user.pending = not reached or not (await self._call_upstream(lambda r: r.put_user(user)))[0]
        await self.repo.put_user(user)
        await self._changed()
        return self._session_reply(user)

    async def _find_user(self, uid: str) -> User | None:
        """A user of this store, or (online on the PC) of Atlas, copied here: they join this class."""
        user = await self.repo.get_user(uid)
        if user and not user.deleted:
            return user
        _, remote = await self._call_upstream(lambda r: r.get_user(uid))
        if remote and not remote.deleted:
            await self.repo.put_user(remote)
            return remote
        return None

    async def login(self, username: Any, key: Any) -> dict[str, Any]:
        name, key = check_username(username), check_key(key)
        uid = self.keys.user_id(name)
        user = await self._find_user(uid)
        if not (user and password_ok(user, key)):
            # Renamed by a sync (the name was taken in another class)? The old name still works
            new_uid = await self.repo.get_alias(uid)
            if new_uid is None:
                _, new_uid = await self._call_upstream(lambda r: r.get_alias(uid))
            user = await self._find_user(new_uid) if new_uid else None
            if not (user and password_ok(user, key)):
                raise ServiceError(401, "Wrong username or password")
        reply = self._session_reply(user)
        if user.notice:  # shown once
            user.notice = ""
            user.updated = now_ms()
            await self.repo.put_user(user)
            await self._changed()
        return reply

    async def me(self, session: Session) -> dict[str, Any]:
        user = await self.repo.get_user(session.uid)
        if not user or user.deleted:
            raise ServiceError(401, "Log in first")
        return {"user": user.public()}

    # ---- melodies
    async def list_melodies(self, session: Session, scope: str) -> list[dict[str, Any]]:
        if scope == "public":
            found = await self.repo.find_melodies(public=True)
        elif scope == "mine":
            found = await self.repo.find_melodies(owners=[session.uid])
        else:
            raise ServiceError(400, "scope must be mine or public")
        found.sort(key=lambda m: m.updated, reverse=True)
        return [m.summary() for m in found]

    async def _readable(self, session: Session, mid: str) -> Melody:
        m = await self.repo.get_melody(mid) if isinstance(mid, str) and len(mid) == 32 else None
        if not m or m.deleted or (not m.public and m.owner != session.uid):
            raise ServiceError(404, "Melody not found")
        return m

    async def get_melody(self, session: Session, mid: str) -> dict[str, Any]:
        return (await self._readable(session, mid)).full()

    async def create_melody(self, session: Session, data: Any) -> dict[str, Any]:
        d = check_melody(data)
        free = await self.repo.free_bytes()
        if free is not None and free < RESERVE_BYTES + len(d.notes):
            raise ServiceError(507, "The board's memory is full: delete some melodies first")
        now = now_ms()
        m = Melody(
            id=uuid.uuid4().hex,
            owner=session.uid,
            owner_name=session.username,
            name=d.name,
            bpm=d.bpm,
            notes=d.notes,
            length=d.length,
            public=d.public,
            created=now,
            updated=now,
            edited_by=session.username,
        )
        await self.repo.put_melody(m)
        await self._changed()
        return m.full()

    async def update_melody(self, session: Session, mid: str, data: Any) -> dict[str, Any]:
        m = await self._readable(session, mid)
        d = check_melody(data)
        m.name, m.bpm, m.notes, m.length = d.name, d.bpm, d.notes, d.length
        if m.owner == session.uid:  # only the owner changes who can see it
            m.public = d.public
        m.edited_by = session.username
        m.updated = max(now_ms(), m.updated + 1)
        await self.repo.put_melody(m)
        await self._changed()
        return m.full()

    async def delete_melody(self, session: Session, mid: str) -> None:
        m = await self._readable(session, mid)
        if m.owner != session.uid:
            raise ServiceError(403, "Only its owner can delete a melody")
        m.deleted, m.notes = True, ""
        m.updated = max(now_ms(), m.updated + 1)
        await self.repo.put_melody(m)
        await self._changed()
