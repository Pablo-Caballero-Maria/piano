"""The REST API both servers expose (the teacher's PC and Vercel), on top of :class:`Service`.

====================================  ================================================
``POST /api/auth/register``           {username, role, key} → {token, user, notice}
``POST /api/auth/login``              {username, key} → {token, user, notice}
``GET  /api/auth/me``                 → {user}
``GET  /api/melodies?scope=mine``     → {melodies: [summary…]} (``scope=public``: everyone's)
``GET  /api/melodies/{id}``           → {melody}
``POST /api/melodies``                {name, bpm, notes, length, public} → {melody}
``PUT  /api/melodies/{id}``           same body → {melody}
``DELETE /api/melodies/{id}``         → {}
====================================  ================================================

Requests other than sign-up and login carry ``Authorization: Bearer <token>``. Errors are
``{"error": message}`` with an HTTP status (400 invalid, 401 not logged in, 403, 404, 409 taken,
503 board offline, 507 board full).
"""

# No `from __future__ import annotations` here: FastAPI must see the real types of the
# dependencies defined inside make_router().
from collections.abc import Callable
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, FastAPI, Header, Request
from fastapi.responses import JSONResponse

from .auth import Session, read_token
from .models import Invalid
from .service import Service, ServiceError

JSON = Annotated[dict[str, Any], Body()]


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ServiceError)
    async def _service_error(request: Request, e: ServiceError) -> JSONResponse:
        return JSONResponse({"error": e.message}, status_code=e.status)

    @app.exception_handler(Invalid)
    async def _invalid(request: Request, e: Invalid) -> JSONResponse:
        return JSONResponse({"error": str(e)}, status_code=400)


def make_router(get_service: Callable[..., Service]) -> APIRouter:
    """The router; ``get_service`` is a FastAPI dependency that returns the Service to use."""
    router = APIRouter(prefix="/api")
    ServiceDep = Annotated[Service, Depends(get_service)]

    def session(svc: ServiceDep, authorization: Annotated[str | None, Header()] = None) -> Session:
        token = authorization.removeprefix("Bearer ").strip() if authorization else None
        s = read_token(svc.keys, token)
        if s is None:
            raise ServiceError(401, "Log in first")
        return s

    SessionDep = Annotated[Session, Depends(session)]

    @router.post("/auth/register")
    async def register(svc: ServiceDep, body: JSON) -> dict[str, Any]:
        return await svc.register(body.get("username"), body.get("role"), body.get("key"))

    @router.post("/auth/login")
    async def login(svc: ServiceDep, body: JSON) -> dict[str, Any]:
        return await svc.login(body.get("username"), body.get("key"))

    @router.get("/auth/me")
    async def me(svc: ServiceDep, s: SessionDep) -> dict[str, Any]:
        return await svc.me(s)

    @router.get("/melodies")
    async def list_melodies(svc: ServiceDep, s: SessionDep, scope: str = "mine") -> dict[str, Any]:
        return {"melodies": await svc.list_melodies(s, scope)}

    @router.get("/melodies/{mid}")
    async def get_melody(svc: ServiceDep, s: SessionDep, mid: str) -> dict[str, Any]:
        return {"melody": await svc.get_melody(s, mid)}

    @router.post("/melodies")
    async def create_melody(svc: ServiceDep, s: SessionDep, body: JSON) -> dict[str, Any]:
        return {"melody": await svc.create_melody(s, body)}

    @router.put("/melodies/{mid}")
    async def update_melody(svc: ServiceDep, s: SessionDep, mid: str, body: JSON) -> dict[str, Any]:
        return {"melody": await svc.update_melody(s, mid, body)}

    @router.delete("/melodies/{mid}")
    async def delete_melody(svc: ServiceDep, s: SessionDep, mid: str) -> dict[str, Any]:
        await svc.delete_melody(s, mid)
        return {}

    return router
