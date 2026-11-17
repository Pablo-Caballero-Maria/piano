"""Runs :func:`pianocore.sync.sync` between the classroom board and Atlas: every few minutes, and
shortly after anything changes, whenever the PC is online and the board is reachable."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable

from pianocore.crypto import Keys
from pianocore.repo import Repo
from pianocore.sync import sync

log = logging.getLogger(__name__)
DEBOUNCE_S = 10


class SyncService:
    def __init__(
        self,
        board: Repo,
        atlas: Repo | None,
        keys: Keys,
        ready: Callable[[], bool],
        every_s: int = 300,
    ) -> None:
        """ready(): online and the board answers."""
        self.board, self.atlas, self.keys, self.ready, self.every_s = board, atlas, keys, ready, every_s
        self._poke = asyncio.Event()
        self.last: dict[str, object] = {}

    def poke(self) -> None:
        """Something changed: sync soon."""
        self._poke.set()

    async def once(self) -> bool:
        if self.atlas is None or not self.ready():
            return False
        try:
            report = await sync(self.board, self.atlas, self.keys)
        except Exception as e:
            log.warning("Sync failed: %r", e)
            self.last = {"at": int(time.time()), "ok": False, "result": f"Sync failed: {e}"}
            return False
        log.info("Sync: %s", report)
        self.last = {"at": int(time.time()), "ok": True, "result": str(report)}
        return True

    async def run(self) -> None:
        while True:
            try:
                await asyncio.wait_for(self._poke.wait(), self.every_s)
                await asyncio.sleep(DEBOUNCE_S)  # let a burst of changes settle
            except TimeoutError:
                pass
            self._poke.clear()
            await self.once()
