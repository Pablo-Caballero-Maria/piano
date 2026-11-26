"""The security headers of every response the PC sends: Content Security Policy, nosniff, no framing…

They're defined once, in the website (``web/src/lib/site-security.ts``, the "classroom" set: plain
HTTP on the school's network and the class's WebSocket to this PC), and ``npm run build`` writes them
to ``web/out/_server/headers.json`` next to the site they belong to. Vercel gets the "online" set
from ``vercel.json``, written from the same definition.

The file is read again whenever it changes, so an update (a new build put in place by
:func:`fog.website.install`) brings its headers along without restarting the app. Without it (a
build from before they existed), responses go out without them, as they did then.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from starlette.types import ASGIApp, Message, Receive, Scope, Send

log = logging.getLogger(__name__)

HEADERS_FILE = "_server/headers.json"


class SecurityHeaders:
    """The headers in a build's headers.json, as raw ASGI header pairs."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._mtime: float | None = None
        self._headers: list[tuple[bytes, bytes]] = []

    def current(self) -> list[tuple[bytes, bytes]]:
        try:
            mtime = self.path.stat().st_mtime
        except OSError:
            self._mtime, self._headers = None, []
            return self._headers
        if mtime != self._mtime:
            self._mtime, self._headers = mtime, self._read()
        return self._headers

    def _read(self) -> list[tuple[bytes, bytes]]:
        try:
            entries = json.loads(self.path.read_text())
            return [
                (str(e["key"]).lower().encode("latin-1"), str(e["value"]).encode("latin-1")) for e in entries
            ]
        except (OSError, ValueError, KeyError, TypeError):
            log.warning("Unreadable security headers (%s): responses go out without them", self.path)
            return []


class SecurityHeadersMiddleware:
    """Adds the security headers to every HTTP response (WebSockets are left alone).

    A header the response already has (one an endpoint set on purpose) is kept.
    """

    def __init__(self, app: ASGIApp, headers: SecurityHeaders) -> None:
        self.app = app
        self.headers = headers

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                present = {key.lower() for key, _ in message.get("headers", [])}
                extra = [(k, v) for k, v in self.headers.current() if k not in present]
                message["headers"] = [*message.get("headers", []), *extra]
            await send(message)

        await self.app(scope, receive, send_with_headers)
