"""Relays the classroom's live lesson to Ably, so students at home can follow it (on the Vercel
site), and lists who follows from home for the teacher.

Publishing never blocks the class: messages wait in a small buffer that keeps only the latest one
of each kind (a burst of notes collapses into the last one), and a background task sends them
while the PC is online. See :mod:`pianocore.ably` for the channel and message format.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import Callable
from typing import Any

import httpx

from pianocore import ably

log = logging.getLogger(__name__)
PRESENCE_EVERY_S = 5


class AblyBridge:
    def __init__(
        self, api_key: str, online: Callable[[], bool], http: httpx.AsyncClient | None = None
    ) -> None:
        ably.split_key(api_key)  # fail early on a malformed key
        self.api_key = api_key
        self.online = online
        self.http = http or httpx.AsyncClient()
        self._pending: dict[
            tuple[str, str], tuple[str, Any]
        ] = {}  # (channel, name) -> (teacher, latest data)
        self._wake = asyncio.Event()
        self._live: str | None = None
        self._followers: list[dict[str, Any]] = []
        self._polled = 0.0

    def publish(self, teacher: str, name: str, data: Any) -> None:
        """Queue a lesson event (returns at once)."""
        if name == "lesson":
            self._live = teacher if data.get("live") else None
            if not self._live:
                self._followers = []
        self._pending[(ably.channel(teacher), name)] = (teacher, data)
        self._wake.set()

    def followers(self, teacher: str) -> list[dict[str, Any]]:
        """Students following ``teacher``'s lesson from home, as classroom people (remote=True)."""
        return list(self._followers) if teacher == self._live else []

    async def _flush(self) -> None:
        while self._pending and self.online():
            (chan, name), (teacher, data) = next(iter(self._pending.items()))
            del self._pending[(chan, name)]
            try:
                await ably.publish(self.http, self.api_key, chan, name, data, client_id=teacher)
            except Exception as e:
                log.warning("Ably publish failed: %r", e)
                return

    async def _poll_presence(self) -> None:
        if not self._live or not self.online():
            return
        try:
            members = await ably.presence(
                self.http, self.api_key, ably.channel(self._live), client_id=self._live
            )
        except Exception as e:
            log.warning("Ably presence failed: %r", e)
            return
        self._followers = [
            {
                "id": "ably:" + str(p["clientId"]),
                "name": str(p["clientId"]),
                "role": "student",
                "mode": p["data"].get("mode", "piano"),
                "notes": p["data"].get("notes", []),
                "detail": str(p["data"].get("detail", ""))[:120],
                "since": 0,
                "remote": True,
            }
            for p in members
            if p["clientId"] and str(p["clientId"]).lower() != self._live.lower()  # not the teacher
        ]

    async def run(self) -> None:
        while True:
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), PRESENCE_EVERY_S)
            self._wake.clear()
            await self._flush()
            if time.monotonic() - self._polled >= PRESENCE_EVERY_S:
                self._polled = time.monotonic()
                await self._poll_presence()
