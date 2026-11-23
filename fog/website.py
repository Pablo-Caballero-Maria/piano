"""The website the PC serves to the phones: the static export of the Next.js project in ``web/``.

The repository only has its source (TypeScript). ``./install.sh`` builds it once (``npm run build``
→ ``web/out``), and every update from GitHub builds the new version while testing it
(:mod:`fog.updater`): the build is *staged* next to the live one and put in place with
:func:`install` once the new version is checked out, so phones never see a half-built site.

Node.js comes from the ``nodejs-wheel`` Python package (the ``web`` dependency group in
``pyproject.toml``), so ``uv run --group web npm`` works on any PC that has uv, with the Node
version pinned in ``uv.lock``.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from starlette.responses import PlainTextResponse, Response
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

SOURCE = "web"
BUILT = "web/out"
STAGED = "web/out.new"
NPM = ["uv", "run", "--frozen", "--group", "web", "npm"]
# The website's packages, tests and build, run from the repository's root (by the updater)
BUILD_COMMANDS: list[list[str]] = [
    [*NPM, "ci", "--prefix", SOURCE, "--no-audit", "--no-fund"],
    [*NPM, "test", "--prefix", SOURCE],
    [*NPM, "run", "build", "--prefix", SOURCE],
]
# Next.js sends anonymous usage data by default: not from the teachers' PCs
BUILD_ENV = {"NEXT_TELEMETRY_DISABLED": "1"}
HINT = "./install.sh builds it (or: uv run --group web npm ci --prefix web, then npm run build the same way)"

# Next.js names its scripts and styles after their content: they never change, so phones may keep them
IMMUTABLE = "public, max-age=31536000, immutable"
REVALIDATE = "no-cache"  # pages: always ask (a 304 if unchanged), so updates show up at once


def describe(cmd: list[str]) -> str:
    """A command without uv's part: "npm run build --prefix web"."""
    return " ".join(cmd[cmd.index("npm") :] if "npm" in cmd else cmd)


def built_dir(repo: Path) -> Path:
    return repo / BUILT


def is_built(repo: Path) -> bool:
    return (built_dir(repo) / "index.html").is_file()


# The build's server code (Better Auth, run by fog.auth_server), not part of the site
PRIVATE = "_server/"
# The service worker lives at /serwist/sw.js but controls the whole site
SERVICE_WORKER = "serwist/"


class Site(StaticFiles):
    """The built website, with cache headers for phones on the classroom WiFi."""

    def __init__(self, directory: Path) -> None:
        super().__init__(directory=directory, html=True)

    async def get_response(self, path: str, scope: Scope) -> Response:
        if path.startswith(PRIVATE):
            return PlainTextResponse("Not Found", status_code=404)
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = IMMUTABLE if path.startswith("_next/static/") else REVALIDATE
        if path.startswith(SERVICE_WORKER):
            response.headers["Service-Worker-Allowed"] = "/"
        return response


NOT_BUILT_PAGE = f"""<!doctype html><meta charset="utf-8"><title>ESP32 Piano</title>
<p>The website isn't built on this PC yet: run <code>{HINT}</code>.</p>"""


def stage(worktree: Path, repo: Path) -> bool:
    """Move the site built in ``worktree`` (a tested new version) next to the live one.
    False if it built nothing (e.g. the tests didn't build it)."""
    built = worktree / BUILT
    if not (built / "index.html").is_file():
        return False
    staged = repo / STAGED
    shutil.rmtree(staged, ignore_errors=True)
    staged.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(built, staged)
    return True


def install(repo: Path) -> bool:
    """Put the staged site in place of the live one; True if there was one."""
    staged = repo / STAGED
    if not staged.is_dir():
        return False
    live = built_dir(repo)
    old = repo / "web/out.old"
    shutil.rmtree(old, ignore_errors=True)
    if live.exists():
        live.rename(old)
    staged.rename(live)
    shutil.rmtree(old, ignore_errors=True)
    return True
