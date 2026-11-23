"""Better Auth on the teacher's PC: a Node.js process next to this app.

Accounts are Better Auth's (web/server/auth). The website's build bundles its server into
``web/out/_server/auth.mjs`` (so a tested update brings it along with the site, see
:mod:`fog.website`), and this app runs it with the Node.js that uv installs
(``uv run --group web node …``, the same Node that builds the website) on a free port of
127.0.0.1. It's restarted if it stops. nginx only talks to this app, which forwards every
``/api/auth/*`` request to it (:meth:`AuthServer.forward`); Better Auth keeps its accounts and
sessions through this app's accounts API (:mod:`pianocore.accounts_api`, at
``/internal/accounts``), so they live on the board like everything else.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import shutil
import socket
from collections.abc import Mapping
from pathlib import Path

import httpx
from fastapi import Request
from fastapi.responses import JSONResponse, Response

from .website import BUILT

log = logging.getLogger(__name__)

BUNDLE = f"{BUILT}/_server/auth.mjs"
# Headers that belong to one connection, not to the request or answer being forwarded
HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "content-length",
    "content-encoding",
}
NOT_READY = "Accounts are starting on this PC: try again in a moment"


def free_port() -> int:
    """A port nothing listens on now (the OS picks it)."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def client_ip(request: Request) -> str:
    """The phone's address. Behind nginx (a local peer) it's the last address nginx added to
    X-Forwarded-For — earlier ones come from the client and could be anything; otherwise the peer."""
    peer = request.client.host if request.client else ""
    forwarded = [a.strip() for a in request.headers.get("x-forwarded-for", "").split(",") if a.strip()]
    if forwarded and peer in ("127.0.0.1", "::1", "localhost"):
        return forwarded[-1]
    return peer


def uv_command() -> str:
    """uv itself: uv run sets UV for the processes it starts; else whatever is on PATH."""
    return os.environ.get("UV") or shutil.which("uv") or "uv"


class AuthServer:
    """Starts Better Auth's Node server, keeps it running and forwards requests to it."""

    def __init__(
        self,
        repo_dir: Path,
        *,
        data_key: str,
        accounts_url: str,
        public_url: str,
        port: int | None = None,
        command: list[str] | None = None,
        env: Mapping[str, str] | None = None,
        restart_delay_s: float = 3,
    ) -> None:
        self.bundle = repo_dir / BUNDLE
        self.port = port or free_port()
        self._custom_command = command is not None  # tests run another program
        self.command = command or [
            uv_command(),
            "run",
            "--frozen",
            "--group",
            "web",
            "node",
            str(self.bundle),
        ]
        self.cwd = repo_dir
        self.env = {
            **os.environ,
            **(env or {}),
            "NODE_ENV": "production",
            "PIANO_DATA_KEY": data_key,
            "PIANO_AUTH_PORT": str(self.port),
            "PIANO_ACCOUNTS_URL": accounts_url,
            "PIANO_PUBLIC_URL": public_url,
        }
        self.restart_delay_s = restart_delay_s
        self.url = f"http://127.0.0.1:{self.port}"
        self.proc: asyncio.subprocess.Process | None = None
        self._client = httpx.AsyncClient(base_url=self.url, timeout=20)
        self._task: asyncio.Task[None] | None = None

    @property
    def available(self) -> bool:
        """The bundle is built (``npm run build --prefix web``)."""
        return self._custom_command or self.bundle.is_file()

    async def _pipe_logs(self, stream: asyncio.StreamReader) -> None:
        while line := await stream.readline():
            log.info("auth: %s", line.decode(errors="replace").rstrip())

    async def run(self) -> None:
        """Run the server until cancelled, starting it again whenever it stops."""
        if not self.available:
            log.error(
                "Better Auth isn't built (%s): accounts won't work until the website is built", self.bundle
            )
            return
        while True:
            self.proc = await asyncio.create_subprocess_exec(
                *self.command,
                cwd=self.cwd,
                env=self.env,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            log.info("Better Auth started on %s (pid %s)", self.url, self.proc.pid)
            logs = asyncio.create_task(self._pipe_logs(self.proc.stdout)) if self.proc.stdout else None
            code = await self.proc.wait()
            if logs:
                await logs
            log.warning("Better Auth stopped (exit %s); starting it again in %ss", code, self.restart_delay_s)
            await asyncio.sleep(self.restart_delay_s)

    def start(self) -> None:
        self._task = asyncio.create_task(self.run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        if self.proc and self.proc.returncode is None:
            self.proc.terminate()
            try:
                await asyncio.wait_for(self.proc.wait(), 5)
            except TimeoutError:
                self.proc.kill()
        await self._client.aclose()

    async def ready(self, timeout_s: float = 20) -> bool:
        """Wait until it answers (Better Auth's /api/auth/ok)."""
        deadline = asyncio.get_running_loop().time() + timeout_s
        while asyncio.get_running_loop().time() < deadline:
            with contextlib.suppress(httpx.HTTPError):
                if (await self._client.get("/api/auth/ok")).status_code == 200:
                    return True
            await asyncio.sleep(0.2)
        return False

    async def forward(self, request: Request) -> Response:
        """Send a browser's /api/auth/… request to Better Auth and its answer back, as a proxy:
        the public host and scheme (from nginx, or this app's own) and the phone's address go along
        in X-Forwarded-*, so Better Auth checks origins and rate-limits per phone."""
        headers = [
            (k, v) for k, v in request.headers.items() if k.lower() not in HOP_BY_HOP | {"x-forwarded-for"}
        ]
        if ip := client_ip(request):
            headers.append(("x-forwarded-for", ip))
        if "x-forwarded-proto" not in request.headers:
            headers.append(("x-forwarded-proto", request.url.scheme))
        headers.append(("x-forwarded-host", request.headers.get("host", request.url.netloc)))
        headers.append(("accept-encoding", "identity"))
        try:
            upstream = await self._client.request(
                request.method,
                request.url.path,
                params=request.query_params,
                headers=headers,
                content=await request.body(),
            )
        except httpx.HTTPError:
            return JSONResponse({"error": NOT_READY}, status_code=503)
        response = Response(content=upstream.content, status_code=upstream.status_code)
        for k, v in upstream.headers.multi_items():
            if k.lower() not in HOP_BY_HOP:
                response.headers.append(k, v)
        return response
