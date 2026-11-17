"""The teacher's PC server: a FastAPI app that nginx serves on https://piano-esp32.duckdns.org.

Routes (besides the shared REST API of :mod:`pianocore.api`, whose data lives on the board):

=================================  ==========================================================
``GET  /api/config``               {mode: "classroom", realtime: "ws"}: how pages talk to us
``GET  /api/status``               (teacher) board, internet, sync and update status
``POST /api/update``               (teacher) check GitHub for a new version now
``WS   /ws``                       the live class (:mod:`fog.classroom`)
``GET  /board/<sha>/manifest.json``  the board's files in that commit (git hashes, sizes)
``GET  /board/<sha>/<path>``       one of them (the board downloads its updates here)
``/``                              the website (nginx serves it directly in production)
=================================  ==========================================================

:func:`create_app` wires the parts together; background tasks (MQTT, internet checks, sync,
updates, DuckDNS, Ably) start with the app.
"""

# No `from __future__ import annotations`: FastAPI must see the real types of the dependencies
# defined inside create_app().
import asyncio
import contextlib
import logging
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from pianocore.api import install_error_handlers, make_router
from pianocore.auth import Session, read_token
from pianocore.crypto import Keys
from pianocore.kv_repo import KVRepo
from pianocore.mongo_repo import MongoRepo
from pianocore.repo import Repo
from pianocore.service import Service, ServiceError

from .ably_bridge import AblyBridge
from .board import BoardLink
from .classroom import Classroom
from .internet import DuckDNS, Internet
from .settings import Settings
from .sync_service import SyncService
from .updater import Git, Updater, board_path

log = logging.getLogger(__name__)
SHA_RE = re.compile(r"^[0-9a-f]{40}$")


@dataclass
class Fog:
    """Everything the teacher's PC runs, wired together (tests build it with fakes)."""

    settings: Settings
    keys: Keys
    board: BoardLink
    internet: Internet
    atlas: Repo | None
    service: Service
    sync: SyncService
    classroom: Classroom
    updater: Updater
    bridge: AblyBridge | None = None
    duckdns: DuckDNS | None = None
    tasks: list[asyncio.Task[Any]] = field(default_factory=list)
    skip: set[str] = field(default_factory=set)  # background parts not to start ("board", "updater"…)

    @classmethod
    def build(cls, settings: Settings, atlas: Repo | None = None, board: BoardLink | None = None) -> "Fog":
        keys = Keys.from_text(settings.data_key)
        board = board or BoardLink(settings.board_id)
        internet = Internet()
        if atlas is None and settings.mongodb_uri:
            atlas = MongoRepo.connect(settings.mongodb_uri, keys, settings.mongodb_db)
        board_repo = KVRepo(board, keys)
        sync = SyncService(
            board_repo,
            atlas,
            keys,
            ready=lambda: internet.online and board.online,
            every_s=settings.sync_every_s,
        )
        service = Service(
            board_repo, keys, upstream=lambda: atlas if internet.online else None, on_change=sync.poke
        )
        bridge = (
            AblyBridge(settings.ably_api_key, online=lambda: internet.online)
            if settings.ably_api_key
            else None
        )
        classroom = Classroom(tone=board.tone, board_status=lambda: board_summary(board), bridge=bridge)
        updater = Updater(
            Git(settings.repo_dir, url=settings.git_url),
            board,
            online=lambda: internet.online,
            public_url=settings.public_url,
            every_s=settings.update_every_s,
            auto=settings.auto_update,
        )
        duckdns = (
            DuckDNS(settings.duckdns_domain, settings.duckdns_token, internet)
            if settings.duckdns_domain and settings.duckdns_token
            else None
        )
        fog = cls(settings, keys, board, internet, atlas, service, sync, classroom, updater, bridge, duckdns)

        async def on_board_status(status: dict[str, Any]) -> None:
            await classroom.board_changed()
            if status.get("online"):
                sync.poke()
                await updater.update_board(status)

        board.listeners.append(on_board_status)
        return fog

    def start(self) -> None:
        s = self.settings
        jobs = {
            "board": lambda: self.board.run(s.mqtt_host, s.mqtt_port, s.mqtt_user, s.mqtt_password),
            "internet": self.internet.run,
            "sync": self.sync.run,
            "updater": self.updater.run,
            "duckdns": self.duckdns.run if self.duckdns else None,
            "bridge": self.bridge.run if self.bridge else None,
        }
        self.tasks = [
            asyncio.create_task(job()) for name, job in jobs.items() if job and name not in self.skip
        ]

    async def stop(self) -> None:
        for t in self.tasks:
            t.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        if isinstance(self.atlas, MongoRepo):
            await self.atlas.client.close()


def board_summary(board: BoardLink) -> dict[str, Any]:
    s = board.status
    return {"online": board.online, "version": (s.get("sha") or "")[:7], "free": s.get("free")}


def create_app(settings: Settings | None = None, fog: Fog | None = None, background: bool = True) -> FastAPI:
    settings = settings or Settings.load()
    fog = fog or Fog.build(settings)

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if background:
            fog.start()
        yield
        await fog.stop()

    app = FastAPI(title="Piano class (teacher's PC)", lifespan=lifespan, docs_url=None, redoc_url=None)
    app.state.fog = fog
    install_error_handlers(app)
    app.include_router(make_router(lambda: fog.service))

    def teacher(authorization: Annotated[str | None, Header()] = None) -> Session:
        s = read_token(fog.keys, authorization.removeprefix("Bearer ").strip() if authorization else None)
        if s is None:
            raise ServiceError(401, "Log in first")
        if not s.is_teacher:
            raise ServiceError(403, "Only teachers can see this")
        return s

    @app.get("/api/config")
    async def config() -> dict[str, Any]:
        return {"mode": "classroom", "realtime": "ws", "board": board_summary(fog.board)}

    @app.get("/api/status")
    async def status(_: Annotated[Session, Depends(teacher)]) -> dict[str, Any]:
        return {
            "board": {**board_summary(fog.board), "log": fog.board.log_lines[-5:]},
            "internet": fog.internet.online,
            "sync": fog.sync.last or None,
            "update": {"version": (await fog.updater.git.head())[:7], **fog.updater.last},
        }

    @app.post("/api/update")
    async def update_now(_: Annotated[Session, Depends(teacher)]) -> JSONResponse:
        if not fog.internet.online:
            raise ServiceError(409, "This PC has no internet right now")
        task = asyncio.create_task(fog.updater.check())
        fog.tasks.append(task)
        return JSONResponse({"ok": True}, status_code=202)

    @app.websocket("/ws")
    async def ws(websocket: WebSocket) -> None:
        await websocket.accept()
        try:
            hello = await asyncio.wait_for(websocket.receive_json(), 10)
        except Exception:
            await websocket.close(4400)
            return
        session = read_token(fog.keys, hello.get("token") if isinstance(hello, dict) else None)
        if session is None:
            await websocket.send_json({"t": "error", "message": "Log in to join the class"})
            await websocket.close(4401)
            return
        lock = asyncio.Lock()

        async def send(msg: dict[str, Any]) -> None:
            async with lock:
                await websocket.send_json(msg)

        member = await fog.classroom.join(session, send, hello.get("mode", "piano"))
        try:
            while True:
                msg = await websocket.receive_json()
                if isinstance(msg, dict):
                    await fog.classroom.handle(member, msg)
        except (WebSocketDisconnect, ValueError, RuntimeError):
            pass
        finally:
            await fog.classroom.leave(member)

    @app.get("/board/{sha}/manifest.json")
    async def board_manifest(sha: str) -> dict[str, Any]:
        if not SHA_RE.match(sha) or await fog.updater.git.resolve(sha) is None:
            raise HTTPException(404)
        return {"sha": sha, "files": await fog.updater.git.board_files(sha)}

    @app.get("/board/{sha}/{path:path}")
    async def board_file(sha: str, path: str) -> Response:
        if not SHA_RE.match(sha) or board_path(path) is None or await fog.updater.git.resolve(sha) is None:
            raise HTTPException(404)
        files = await fog.updater.git.board_files(sha)
        if path not in files:
            raise HTTPException(404)
        return Response(await fog.updater.git.show(sha, path), media_type="application/octet-stream")

    web = settings.repo_dir / "web" / "public"
    if web.is_dir():  # nginx serves these itself; this is for running without it
        app.mount("/", StaticFiles(directory=web, html=True), name="web")
    return app
