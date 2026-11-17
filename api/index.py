"""The Vercel serverless API (https://piano-web-virid.vercel.app/api/…), for every class.

The same REST API as the teacher's PC (:mod:`pianocore.api`), on MongoDB Atlas, plus what online
lessons need (Ably, see :mod:`pianocore.ably`):

==========================  ====================================================================
``GET  /api/config``        {mode: "online", realtime: "ably"}: how pages talk to us
``POST /api/ably/token``    a signed Ably token request for the logged-in user (role-based rights)
``GET  /api/live``          {teachers: […]}: lessons happening right now (online or in a classroom)
==========================  ====================================================================

Environment variables (Vercel project settings, never in git): PIANO_DATA_KEY (the same system
key as the teacher PCs), MONGODB_URI, ABLY_API_KEY, optionally MONGODB_DB.
"""

import asyncio
import os
from typing import Annotated, Any

import httpx
from fastapi import Depends, FastAPI, Header

from pianocore import ably
from pianocore.api import install_error_handlers, make_router
from pianocore.auth import Session, read_token
from pianocore.crypto import Keys
from pianocore.mongo_repo import MongoRepo
from pianocore.service import Service, ServiceError

app = FastAPI(title="Piano (online)", docs_url=None, redoc_url=None, openapi_url=None)
install_error_handlers(app)
_cache: dict[str, Any] = {}


def _env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ServiceError(503, f"The server isn't configured ({name} is missing)")
    return value


def service() -> Service:
    """One Service (and Atlas client) per event loop: serverless instances may switch loops."""
    loop = asyncio.get_running_loop()
    if _cache.get("loop") is not loop:
        keys = Keys.from_text(_env("PIANO_DATA_KEY"))
        repo = MongoRepo.connect(_env("MONGODB_URI"), keys, os.environ.get("MONGODB_DB", "piano"))
        _cache.update(loop=loop, service=Service(repo, keys))
    return _cache["service"]


def session(
    svc: Annotated[Service, Depends(service)], authorization: Annotated[str | None, Header()] = None
) -> Session:
    s = read_token(svc.keys, authorization.removeprefix("Bearer ").strip() if authorization else None)
    if s is None:
        raise ServiceError(401, "Log in first")
    return s


app.include_router(make_router(service))


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
