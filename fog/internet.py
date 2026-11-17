"""Is the teacher's PC on the internet? And keeping its DuckDNS name pointing at it.

The classroom router may have no internet: the PC works offline (the class goes on with the
board), and syncs, updates and relays to Ably whenever it's online.

DuckDNS: ``piano-esp32.duckdns.org`` must resolve to the PC's address *on the classroom network*
(phones and the board reach it there), so the PC sets the record to its LAN IP whenever that
changes and it's online. The Let's Encrypt certificate for the name is obtained with a DNS
challenge (deploy/certbot-duckdns-hook.sh), so it works on a private address.
"""

from __future__ import annotations

import asyncio
import logging
import socket

import httpx

log = logging.getLogger(__name__)
CHECK_EVERY_S = 30


def lan_ip() -> str | None:
    """This PC's address on the network that holds the default route (no packet is sent)."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("192.0.2.1", 9))  # TEST-NET-1: only picks the route
            return s.getsockname()[0]
        except OSError:
            return None


class Internet:
    def __init__(self, probe_host: str = "github.com", probe_port: int = 443) -> None:
        self.online = False
        self.probe = (probe_host, probe_port)

    async def check(self) -> bool:
        try:
            _, writer = await asyncio.wait_for(asyncio.open_connection(*self.probe), 4)
            writer.close()
            online = True
        except (OSError, TimeoutError):
            online = False
        if online != self.online:
            log.info("Internet: %s", "online" if online else "offline")
        self.online = online
        return online

    async def run(self) -> None:
        while True:
            await self.check()
            await asyncio.sleep(CHECK_EVERY_S)


async def duckdns_update(http: httpx.AsyncClient, domain: str, token: str, ip: str) -> bool:
    r = await http.get(
        "https://www.duckdns.org/update", params={"domains": domain, "token": token, "ip": ip}, timeout=10
    )
    return r.text.strip() == "OK"


class DuckDNS:
    def __init__(
        self, domain: str, token: str, internet: Internet, http: httpx.AsyncClient | None = None
    ) -> None:
        self.domain = domain.removesuffix(".duckdns.org")
        self.token = token
        self.internet = internet
        self.http = http or httpx.AsyncClient()
        self.ip: str | None = None

    async def tick(self) -> None:
        ip = lan_ip()
        if ip and ip != self.ip and self.internet.online:
            try:
                if await duckdns_update(self.http, self.domain, self.token, ip):
                    log.info("DuckDNS: %s.duckdns.org -> %s", self.domain, ip)
                    self.ip = ip
                else:
                    log.warning("DuckDNS refused the update (check DUCKDNS_TOKEN)")
            except httpx.HTTPError as e:
                log.warning("DuckDNS: %r", e)

    async def run(self) -> None:
        while True:
            await self.tick()
            # Cheap (the address is looked up locally; DuckDNS is only called when it changes), so
            # a PC brought back to the classroom points the name at itself within half a minute
            await asyncio.sleep(CHECK_EVERY_S)
