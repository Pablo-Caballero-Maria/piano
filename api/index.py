"""The Vercel serverless API (https://esp32-piano.vercel.app/api/…), for every class.

The same REST API as the teacher's PC (:mod:`pianocore.api`), on MongoDB Atlas, the accounts API
of Better Auth's store (:mod:`pianocore.accounts_api`, at ``/api/internal/accounts``: Better Auth
itself is the Node function api/auth.ts, at ``/api/auth/*``), plus what online lessons need
(Ably, see :mod:`pianocore.ably`):

==========================  ====================================================================
``GET  /api/config``        {mode: "online", realtime: "ably"}: how pages talk to us
``POST /api/ably/token``    a signed Ably token request for the logged-in user (role-based rights)
``GET  /api/live``          {teachers: […]}: lessons happening right now (online or in a classroom)
==========================  ====================================================================

Environment variables (Vercel project settings, never in git): PIANO_DATA_KEY (the same system
key as the teacher PCs), MONGODB_URI, ABLY_API_KEY, optionally MONGODB_DB.
"""

import asyncio
import logging
import os
from typing import Annotated, Any

import httpx
from fastapi import Depends, FastAPI, Header, Request
from fastapi.responses import JSONResponse

from pianocore import ably
from pianocore.accounts_api import make_accounts_router
from pianocore.api import install_error_handlers, make_router
from pianocore.auth import Session, bearer
from pianocore.crypto import Keys
from pianocore.mongo_repo import MongoRepo
from pianocore.service import Service, ServiceError

app = FastAPI(title="Piano (online)", docs_url=None, redoc_url=None, openapi_url=None)
install_error_handlers(app)
log = logging.getLogger("api")


@app.exception_handler(Exception)
async def _unexpected(request: Request, e: Exception) -> JSONResponse:
    """A bug or an unreachable Atlas: JSON for the page, the traceback for Vercel's logs."""
    log.exception("Unexpected error on %s", request.url.path)
    return JSONResponse({"error": f"Server error ({type(e).__name__})"}, status_code=500)


_cache: dict[str, Any] = {}


def _env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ServiceError(503, f"The server isn't configured ({name} is missing)")
    return value


async def service() -> Service:
    """One Service (and Atlas client) per event loop: serverless instances may switch loops.
    (async: FastAPI runs sync dependencies in a worker thread, which has no event loop)"""
    loop = asyncio.get_running_loop()
    if _cache.get("loop") is not loop:
        try:
            keys = Keys.from_text(_env("PIANO_DATA_KEY"))
        except ValueError as e:  # never echo the value itself
            raise ServiceError(503, f"The server's PIANO_DATA_KEY is invalid: {e}") from e
        try:
            repo = MongoRepo.connect(_env("MONGODB_URI"), keys, os.environ.get("MONGODB_DB", "piano"))
        except ServiceError:
            raise
        except Exception as e:
            raise ServiceError(503, f"The server's MONGODB_URI doesn't work: {type(e).__name__}") from e
        _cache.update(loop=loop, service=Service(repo, keys))
    return _cache["service"]


async def session(
    svc: Annotated[Service, Depends(service)], authorization: Annotated[str | None, Header()] = None
) -> Session:
    s = await svc.sessions.read(bearer(authorization))
    if s is None:
        raise ServiceError(401, "Log in first")
    return s


app.include_router(make_router(service))
app.include_router(make_accounts_router("/api/internal/accounts", service))


@app.get("/api/config")
async def config() -> dict[str, Any]:
    return {"mode": "online", "realtime": "ably" if os.environ.get("ABLY_API_KEY") else None}


@app.post("/api/ably/token")
async def ably_token(s: Annotated[Session, Depends(session)]) -> dict[str, Any]:
    return ably.token_request(_env("ABLY_API_KEY"), s.username, ably.capability(s))


@app.get("/api/live")
async def live(s: Annotated[Session, Depends(session)]) -> dict[str, Any]:
    async with httpx.AsyncClient() as http:
        return {"teachers": await ably.live_lessons(http, _env("ABLY_API_KEY"))}
