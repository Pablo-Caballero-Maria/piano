"""``uv run python -m fog [serve | demo | keygen | check]``.

- ``serve`` (default): run the teacher's PC server (127.0.0.1:8080; nginx serves it on 443).
- ``demo``: try it without a board, broker or nginx: a simulated board (its storage in
  .demo-board/, the buzzer's notes in the log), on http://localhost:8080. No .env needed (the
  website must be built: ``npm ci --prefix web && npm run build --prefix web``).
  ``demo --cloud`` also syncs with Atlas and relays lessons to Ably, with .env's PIANO_DATA_KEY,
  MONGODB_URI and ABLY_API_KEY (the same system as Vercel; its board in .demo-board-cloud/).
  ``--port N`` listens on another port; ``--fresh`` starts with an empty board, deleted at the end
  (the website's end-to-end tests use both).
- ``keygen``: print a new system key for PIANO_DATA_KEY (once per installation: every teacher PC
  and Vercel must share the same one, or they can't read each other's data).
- ``check``: check the settings in .env and what's reachable (MQTT broker, Atlas, Ably, DuckDNS).
"""

from __future__ import annotations

import asyncio
import logging
import sys

from pianocore.crypto import Keys, new_system_key

from .settings import Settings


async def check(settings: Settings) -> bool:
    ok = True

    def report(name: str, good: bool, detail: str = "") -> None:
        nonlocal ok
        ok &= good
        print(f"{'ok ' if good else 'BAD'}  {name}{': ' + detail if detail else ''}")

    try:
        Keys.from_text(settings.data_key)
        report("PIANO_DATA_KEY", True)
    except ValueError as e:
        report("PIANO_DATA_KEY", False, str(e))
    try:
        import aiomqtt

        async with aiomqtt.Client(
            settings.mqtt_host,
            settings.mqtt_port,
            username=settings.mqtt_user or None,
            password=settings.mqtt_password or None,
            timeout=5,
        ):
            report("MQTT broker", True, f"{settings.mqtt_host}:{settings.mqtt_port}")
    except Exception as e:
        report("MQTT broker", False, repr(e))
    if settings.mongodb_uri:
        from pianocore.mongo_repo import MongoRepo

        repo = MongoRepo.connect(settings.mongodb_uri, Keys.from_text(settings.data_key), settings.mongodb_db)
        try:
            await repo.ping()
            report("MongoDB Atlas", True)
        except Exception as e:
            report("MongoDB Atlas", False, repr(e))
        finally:
            await repo.client.close()
    else:
        print("---  MongoDB Atlas: MONGODB_URI not set (no sync)")
    if settings.ably_api_key:
        from pianocore import ably

        try:
            ably.split_key(settings.ably_api_key)
            report("Ably key", True)
        except ValueError as e:
            report("Ably key", False, str(e))
    from . import website

    report(
        "Website",
        website.is_built(settings.repo_dir),
        "built" if website.is_built(settings.repo_dir) else f"not built: {website.HINT}",
    )
    from .internet import lan_ip

    print(f"---  LAN IP: {lan_ip()} (DuckDNS: {settings.duckdns_domain or 'not set'})")
    return ok


def demo(cloud: bool = False, port: int = 8080, fresh: bool = False) -> None:
    """The PC's app with a simulated board, on localhost:<port>: offline, or (cloud) with Atlas sync
    and the Ably relay of the real system. No MQTT broker, updates or DuckDNS either way.
    fresh: an empty board in a temporary folder (deleted at the end) instead of .demo-board/."""
    import shutil
    import tempfile
    from dataclasses import replace
    from pathlib import Path

    import uvicorn

    from . import website
    from .app import Fog, create_app
    from .settings import REPO_DIR
    from .simboard import SimulatedBoard

    url = f"http://localhost:{port}"
    if fresh:
        folder = Path(tempfile.mkdtemp(prefix="piano-demo-"))
    else:
        folder = REPO_DIR / (".demo-board-cloud" if cloud else ".demo-board")
        folder.mkdir(exist_ok=True)
    if cloud:
        real = Settings.load()
        settings = replace(real, auto_update=False, public_url=url, duckdns_token="", sync_every_s=60)
    else:
        key_file = folder / "system.key"  # keeps the demo's accounts readable across runs
        if not key_file.exists():
            key_file.write_text(new_system_key())
        settings = Settings(data_key=key_file.read_text().strip(), auto_update=False, public_url=url)
    log = logging.getLogger("demo")
    board = SimulatedBoard(folder, on_tone=lambda f: log.info("Buzzer: %s", f"{f} Hz" if f else "silence"))
    fog = Fog.build(settings, board=board.link)
    fog.skip = {"board", "updater", "duckdns"}  # the board is simulated; nothing updates
    where = " (cloud: Atlas sync, Ably relay)" if cloud else ""
    print(f"Demo{where}: open {url} (the board is simulated; Ctrl-C to stop)")
    if not website.is_built(REPO_DIR):
        print(f"The website isn't built yet: {website.HINT}")
    app = create_app(settings, fog, background=cloud)
    try:
        uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
    finally:
        if fresh:
            board.close()
            shutil.rmtree(folder, ignore_errors=True)


def main() -> None:
    command = sys.argv[1] if len(sys.argv) > 1 else "serve"
    if command == "keygen":
        print(new_system_key())
        return
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    # httpx logs every request's URL at INFO, and DuckDNS's token goes in the URL: keep it out of the
    # journal (fog.internet logs the DuckDNS update itself, without the token)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    if command == "demo":
        args = sys.argv[2:]
        port = int(args[args.index("--port") + 1]) if "--port" in args else 8080
        demo(cloud="--cloud" in args, port=port, fresh="--fresh" in args)
        return
    settings = Settings.load()
    if command == "check":
        sys.exit(0 if asyncio.run(check(settings)) else 1)
    if command != "serve":
        sys.exit(__doc__)
    import uvicorn

    from .app import create_app

    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        proxy_headers=True,
        forwarded_allow_ips="127.0.0.1",
        log_level="info",
    )


if __name__ == "__main__":
    main()
