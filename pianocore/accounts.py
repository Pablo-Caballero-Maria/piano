"""Accounts and sign-in sessions: the rules behind Better Auth's store.

Better Auth (web/server/auth) runs the sign-up, sign-in and sign-out flows and hashes passwords;
its store keeps what it needs here, through :mod:`pianocore.accounts_api`, so the records stay
sealed in the same places as before (a classroom board, Atlas) and follow the same rules:

- usernames are unique system-wide: a sign-up on a teacher's PC is checked against Atlas too;
  without internet the account is created *pending*, and the next sync confirms it (or renames it
  if the name was taken meanwhile, see :mod:`pianocore.sync`);
- people from other classes can sign in: their account is copied to the board, so they become
  part of this class; an account renamed by a sync still signs in with its old name (alias);
- sessions stay with the server that created them (the board of the PC, or Atlas for Vercel).
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any

from .auth import session_id
from .crypto import Keys
from .errors import ServiceError
from .models import AuthSession, User, check_password_hash, check_role, check_username, now_ms
from .repo import Repo

log = logging.getLogger(__name__)


Upstream = Callable[[Callable[[Repo], Awaitable[Any]]], Awaitable[tuple[bool, Any]]]


class Accounts:
    def __init__(
        self,
        repo: Repo,
        keys: Keys,
        upstream: Upstream | None = None,
        on_change: Callable[[], Awaitable[None]] | None = None,
        has_upstream: bool = False,
    ) -> None:
        """``upstream(fn)`` runs fn(Atlas) when the PC is online (see Service); ``has_upstream``:
        this is a classroom board, whose sign-ups Atlas must confirm."""
        self.repo = repo
        self.keys = keys
        self._upstream = upstream
        self._on_change = on_change
        self._has_upstream = has_upstream

    async def _remote(self, fn: Callable[[Repo], Awaitable[Any]]) -> tuple[bool, Any]:
        return await self._upstream(fn) if self._upstream else (False, None)

    async def _changed(self) -> None:
        if self._on_change:
            await self._on_change()

    # ---- accounts
    async def get(self, uid: str) -> User | None:
        user = await self.repo.get_user(uid)
        return user if user and not user.deleted else None

    async def _here_or_upstream(self, uid: str) -> User | None:
        """A user of this store, or (online on the PC) of Atlas, copied here: they join this class."""
        user = await self.get(uid)
        if user:
            return user
        _, remote = await self._remote(lambda r: r.get_user(uid))
        if remote and not remote.deleted:
            await self.repo.put_user(remote)
            return remote
        return None

    async def find(self, username: Any) -> User | None:
        """The account that signs in as ``username`` (any case): this store's, Atlas's (copied here),
        or the one a sync renamed it to (its old name keeps signing in)."""
        found = await self.candidates(username)
        return found[0] if found else None

    async def candidates(self, username: Any) -> list[User]:
        """Every account that may sign in as ``username``, the one with that name first. There can
        be two: a pending account renamed by a sync (``ana`` → ``ana-2``) keeps signing in as
        ``ana``, and so does the other ``ana``; the password tells them apart (Better Auth's
        sign-in hook picks the one whose password matches)."""
        uid = self.keys.user_id(check_username(username))
        found = []
        if user := await self._here_or_upstream(uid):
            found.append(user)
        new_uid = await self.repo.get_alias(uid)
        if new_uid is None:
            _, new_uid = await self._remote(lambda r: r.get_alias(uid))
        if new_uid and (renamed := await self._here_or_upstream(new_uid)):
            found.append(renamed)
        return found

    async def _check_name(self, username: Any) -> tuple[bool, bool]:
        """(taken: an account has this name here or in Atlas, reached Atlas)."""
        uid = self.keys.user_id(check_username(username))
        if await self.get(uid):
            return True, False
        reached, remote = await self._remote(lambda r: r.get_user(uid))
        return bool(remote and not remote.deleted), reached

    async def taken(self, username: Any) -> bool:
        """Whether a sign-up can't use this name: an account has it here or (online) in Atlas."""
        return (await self._check_name(username))[0]

    async def register(self, username: Any, role: Any, salt: Any, hash: Any) -> User:
        """A new account with Better Auth's password hash (salt, hash)."""
        name, role = check_username(username), check_role(role)
        salt, hash = check_password_hash(salt, hash)
        taken, checked_in_atlas = await self._check_name(name)
        if taken:
            raise ServiceError(409, "That username is already taken")
        now = now_ms()
        user = User(
            uid=self.keys.user_id(name),
            username=name,
            role=role,
            salt=salt,
            hash=hash,
            created=now,
            updated=now,
        )
        if self._has_upstream:  # a classroom board: confirm in Atlas now, or at the next sync
            saved = checked_in_atlas and (await self._remote(lambda r: r.put_user(user)))[0]
            user.pending = not saved
        await self.repo.put_user(user)
        await self._changed()
        return user

    async def me(self, uid: str) -> dict[str, Any]:
        """The signed-in account, and a notice for them (shown once: e.g. "your username was taken")."""
        user = await self.get(uid)
        if not user:
            raise ServiceError(401, "Log in first")
        notice = user.notice
        if notice:
            user.notice = ""
            user.updated = now_ms()
            await self.repo.put_user(user)
            await self._changed()
        return {"user": user.public(), "notice": notice}

    # ---- sessions
    async def put_session(
        self,
        *,
        token: str,
        uid: str,
        expires: int,
        id: str,
        created: int | None = None,
        updated: int | None = None,
        ip: str = "",
        agent: str = "",
    ) -> AuthSession:
        now = now_ms()
        session = AuthSession(
            sid=session_id(token),
            id=id,
            token=token,
            uid=uid,
            expires=expires,
            created=created or now,
            updated=updated or now,
            ip=ip[:64],
            agent=agent[:200],
        )
        await self.repo.put_session(session)
        return session

    async def get_session(self, token: str) -> AuthSession | None:
        session = await self.repo.get_session(session_id(token))
        if session is None or session.token != token:
            return None
        if session.expired():
            await self.repo.delete_session(session.sid)
            return None
        return session

    async def delete_session(self, token: str) -> None:
        await self.repo.delete_session(session_id(token))

    async def sessions_of(self, uid: str) -> list[AuthSession]:
        return [s for s in await self.repo.sessions_of(uid) if not s.expired()]

    async def delete_sessions_of(self, uid: str) -> int:
        sessions = await self.repo.sessions_of(uid)
        for s in sessions:
            await self.repo.delete_session(s.sid)
        return len(sessions)
