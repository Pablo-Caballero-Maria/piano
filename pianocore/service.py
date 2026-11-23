"""Melodies, and the accounts behind them: the rules both servers apply.

``repo`` is where the records live: a classroom board on the teacher's PC, or Atlas on Vercel.
On the teacher's PC, ``upstream()`` returns Atlas while the PC has internet (else None); the
accounts' rules (unique usernames system-wide, joining a class, Better Auth's sessions) are in
:class:`pianocore.accounts.Accounts`, at ``service.accounts``.

Melodies: the owner sees and edits theirs; public ones can be seen and edited by everyone, but
only the owner can delete them or change their visibility. Deleting leaves a tombstone.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from .accounts import Accounts
from .auth import Session, SessionReader
from .crypto import Keys
from .errors import ServiceError
from .models import Melody, check_melody, now_ms
from .repo import Repo

log = logging.getLogger(__name__)
RESERVE_BYTES = 64 * 1024  # keep this much of a board's flash free

__all__ = ["RESERVE_BYTES", "Service", "ServiceError"]


class Service:
    def __init__(
        self,
        repo: Repo,
        keys: Keys,
        upstream: Callable[[], Repo | None] | None = None,
        on_change: Callable[[], Awaitable[None] | None] | None = None,
        session_ttl_s: float = 0,
    ) -> None:
        """``session_ttl_s``: how long a checked session token is trusted without reading the store
        again (the teacher's PC: its sessions are on the board, see SessionReader)."""
        self.repo = repo
        self.keys = keys
        self._upstream = upstream
        self._on_change = on_change
        self.accounts = Accounts(
            repo,
            keys,
            upstream=self._call_upstream,
            on_change=self._changed,
            has_upstream=upstream is not None,
        )
        self.sessions = SessionReader(repo, keys, ttl_s=session_ttl_s)

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
