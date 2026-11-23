"""The accounts API that Better Auth's store calls (web/server/auth/store.ts), on both servers.

Better Auth (a Node server next to the teacher's PC app, a Node function on Vercel) runs the
sign-up, sign-in and sign-out flows; this API keeps its accounts and sessions with the rules of
:class:`pianocore.accounts.Accounts`. It is internal: every request must carry the system's
internal token (``X-Piano-Internal``, derived from the system key, see ``Keys.internal_token``),
which only the servers know. Mounted at ``/internal/accounts`` on the teacher's PC and at
``/api/internal/accounts`` on Vercel.

All POST, JSON in and out (times in milliseconds):

=========================  ==========================================  ===========================
``/find``                  {username}: the account that signs in so    {account: Account | null}
``/candidates``            {username}: every account that may (the     {accounts: [Account]}
                           password tells them apart)
``/get``                   {uid}                                       {account: Account | null}
``/taken``                 {username}: can a sign-up use it?           {taken: bool}
``/register``              {username, role, salt, hash}                {account} (409 if taken)
``/sessions/put``          {session: Session}                          {}
``/sessions/get``          {token}                                     {session: Session | null}
``/sessions/delete``       {token}                                     {}
``/sessions/of``           {uid}                                       {sessions: [Session]}
``/sessions/delete-of``    {uid}                                       {deleted: n}
=========================  ==========================================  ===========================

``Account`` = {uid, username, role, salt, hash, created, updated}; ``Session`` = {id, token, uid,
expires, created, updated, ip, agent}. Errors are ``{"error": message}`` with a status, as in the
public API.
"""

# No `from __future__ import annotations` here: FastAPI must see the real types of the
# dependencies defined inside make_accounts_router().
import hmac
from collections.abc import Callable
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, Header

from .errors import ServiceError
from .models import AuthSession, Invalid, User
from .service import Service

JSON = Annotated[dict[str, Any], Body()]
INTERNAL_HEADER = "X-Piano-Internal"


def account_json(user: User | None) -> dict[str, Any] | None:
    if user is None:
        return None
    return {
        "uid": user.uid,
        "username": user.username,
        "role": user.role,
        "salt": user.salt,
        "hash": user.hash,
        "created": user.created,
        "updated": user.updated,
    }


def session_json(s: AuthSession | None) -> dict[str, Any] | None:
    if s is None:
        return None
    return {
        "id": s.id,
        "token": s.token,
        "uid": s.uid,
        "expires": s.expires,
        "created": s.created,
        "updated": s.updated,
        "ip": s.ip,
        "agent": s.agent,
    }


def _text(body: dict[str, Any], name: str) -> str:
    value = body.get(name)
    if not isinstance(value, str) or not value:
        raise Invalid(f"Missing {name}")
    return value


def _ms(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise Invalid(f"Bad {name}")
    return int(value)


def make_accounts_router(prefix: str, get_service: Callable[..., Any]) -> APIRouter:
    """The router, at ``prefix``; ``get_service`` is a FastAPI dependency returning the Service."""
    ServiceDep = Annotated[Service, Depends(get_service)]

    async def internal(svc: ServiceDep, x_piano_internal: Annotated[str | None, Header()] = None) -> Service:
        if not x_piano_internal or not hmac.compare_digest(x_piano_internal, svc.keys.internal_token):
            raise ServiceError(403, "Internal API")
        return svc

    Svc = Annotated[Service, Depends(internal)]
    router = APIRouter(prefix=prefix)

    @router.post("/find")
    async def find(svc: Svc, body: JSON) -> dict[str, Any]:
        return {"account": account_json(await svc.accounts.find(body.get("username")))}

    @router.post("/candidates")
    async def candidates(svc: Svc, body: JSON) -> dict[str, Any]:
        return {"accounts": [account_json(u) for u in await svc.accounts.candidates(body.get("username"))]}

    @router.post("/get")
    async def get(svc: Svc, body: JSON) -> dict[str, Any]:
        return {"account": account_json(await svc.accounts.get(_text(body, "uid")))}

    @router.post("/taken")
    async def taken(svc: Svc, body: JSON) -> dict[str, Any]:
        return {"taken": await svc.accounts.taken(body.get("username"))}

    @router.post("/register")
    async def register(svc: Svc, body: JSON) -> dict[str, Any]:
        user = await svc.accounts.register(
            body.get("username"), body.get("role"), body.get("salt"), body.get("hash")
        )
        return {"account": account_json(user)}

    @router.post("/sessions/put")
    async def put_session(svc: Svc, body: JSON) -> dict[str, Any]:
        s = body.get("session")
        if not isinstance(s, dict):
            raise Invalid("Missing session")
        await svc.accounts.put_session(
            token=_text(s, "token"),
            uid=_text(s, "uid"),
            id=_text(s, "id"),
            expires=_ms(s.get("expires"), "expires"),
            created=_ms(s.get("created", 0), "created"),
            updated=_ms(s.get("updated", 0), "updated"),
            ip=str(s.get("ip") or ""),
            agent=str(s.get("agent") or ""),
        )
        return {}

    @router.post("/sessions/get")
    async def get_session(svc: Svc, body: JSON) -> dict[str, Any]:
        return {"session": session_json(await svc.accounts.get_session(_text(body, "token")))}

    @router.post("/sessions/delete")
    async def delete_session(svc: Svc, body: JSON) -> dict[str, Any]:
        token = _text(body, "token")
        await svc.accounts.delete_session(token)
        svc.sessions.forget(token)
        return {}

    @router.post("/sessions/of")
    async def sessions_of(svc: Svc, body: JSON) -> dict[str, Any]:
        return {"sessions": [session_json(s) for s in await svc.accounts.sessions_of(_text(body, "uid"))]}

    @router.post("/sessions/delete-of")
    async def delete_sessions_of(svc: Svc, body: JSON) -> dict[str, Any]:
        uid = _text(body, "uid")
        for s in await svc.accounts.sessions_of(uid):
            svc.sessions.forget(s.token)
        return {"deleted": await svc.accounts.delete_sessions_of(uid)}

    return router
