"""Keeps the teacher's PC and its board on the newest *tested* version of the code on GitHub.

Every hour while the PC is online (and on demand from the teacher's panel):

1. ``git fetch``; if ``origin/main`` moved on (and this checkout has no local changes),
2. the new commit is checked out in a separate git worktree and its whole test suite runs there
   (pytest, and the browser code's tests with Node); if anything fails, nothing changes;
3. the checkout fast-forwards, dependencies are synced, and the service restarts with the new
   code (systemd restarts it). nginx serves the new frontend right away;
4. if the board's firmware differs from the new commit, the board is told to update
   (``piano/<id>/ota``); it downloads its files from ``/board/<sha>/…`` (served here from git),
   checks each file's git hash, runs its own tests and installs them (esp32/ota.py).
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import signal
import tempfile
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)
BOARD_DIRS = ("esp32", "tests/board")
TEST_COMMANDS: list[list[str]] = [["uv", "run", "--frozen", "pytest", "-q", "-p", "no:cacheprovider"]]
if shutil.which("node"):
    TEST_COMMANDS.append(["node", "--test", "tests/web/"])


def board_path(repo_path: str) -> str | None:
    """Where a repository file goes on the board (the same rule as esp32/updater.py)."""
    if repo_path.startswith("esp32/"):
        name = repo_path[6:]
        return name if "/" not in name and name.endswith((".py", ".pem")) else None
    if repo_path.startswith("tests/board/"):
        return "tests/" + repo_path[12:]
    return None


class GitError(RuntimeError):
    pass


class Git:
    def __init__(self, repo_dir: Path, branch: str = "main") -> None:
        self.dir = repo_dir
        self.branch = branch

    async def run(self, *args: str, cwd: Path | None = None, check: bool = True) -> tuple[int, bytes]:
        proc = await asyncio.create_subprocess_exec(
            "git", *args, cwd=cwd or self.dir, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        out, err = await proc.communicate()
        if check and proc.returncode:
            raise GitError(f"git {' '.join(args)}: {err.decode().strip()}")
        return proc.returncode or 0, out

    async def text(self, *args: str) -> str:
        return (await self.run(*args))[1].decode().strip()

    async def head(self) -> str:
        return await self.text("rev-parse", "HEAD")

    async def resolve(self, ref: str) -> str | None:
        code, out = await self.run("rev-parse", "--verify", "--quiet", ref + "^{commit}", check=False)
        return out.decode().strip() if code == 0 else None

    async def board_files(self, sha: str) -> dict[str, list[Any]]:
        """{repo path: [git hash, size]} of the board's files in commit sha."""
        out = await self.text("ls-tree", "-r", "-l", sha, "--", *BOARD_DIRS)
        files: dict[str, list[Any]] = {}
        for line in out.splitlines():
            meta, path = line.split("\t", 1)
            _mode, kind, blob, size = meta.split()
            if kind == "blob" and board_path(path):
                files[path] = [blob, int(size)]
        return files

    async def show(self, sha: str, path: str) -> bytes:
        return (await self.run("show", f"{sha}:{path}"))[1]

    async def board_changed(self, old: str, new: str) -> bool:
        code, _ = await self.run("diff", "--quiet", old, new, "--", *BOARD_DIRS, check=False)
        return code != 0


def restart_service() -> None:
    """Stop this process; systemd (Restart=always) starts it again with the new code."""
    os.kill(os.getpid(), signal.SIGTERM)


class Updater:
    def __init__(
        self,
        git: Git,
        board: Any,  # fog.board.BoardLink
        online: Callable[[], bool],
        public_url: str,
        every_s: int = 3600,
        auto: bool = True,
        test_commands: list[list[str]] | None = None,
        restart: Callable[[], None] = restart_service,
    ) -> None:
        self.git, self.board, self.online = git, board, online
        self.public_url, self.every_s, self.auto = public_url, every_s, auto
        self.test_commands = TEST_COMMANDS if test_commands is None else test_commands
        self.restart = restart
        self.failed: str | None = None
        self.last: dict[str, Any] = {}
        self._busy = asyncio.Lock()

    def _note(self, ok: bool, result: str) -> None:
        log.info("Update: %s", result)
        self.last = {"at": int(time.time()), "ok": ok, "result": result}

    async def _tests_pass(self, sha: str) -> tuple[bool, str]:
        folder = Path(tempfile.mkdtemp(prefix="piano-update-"))
        try:
            await self.git.run("worktree", "add", "--detach", str(folder / "src"), sha)
            env = {
                k: v
                for k, v in os.environ.items()
                if not k.startswith(("PIANO_", "MONGODB", "ABLY", "DUCKDNS"))
            }
            for cmd in self.test_commands:
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    cwd=folder / "src",
                    env=env,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                )
                out, _ = await proc.communicate()
                if proc.returncode:
                    tail = out.decode(errors="replace").strip().splitlines()[-3:]
                    return False, f"{' '.join(cmd[:3])} failed: {' / '.join(tail)}"
            return True, "tests passed"
        finally:
            await self.git.run("worktree", "remove", "--force", str(folder / "src"), check=False)
            shutil.rmtree(folder, ignore_errors=True)

    async def check(self) -> str:
        """One update check. Returns what happened (also kept in self.last)."""
        async with self._busy:
            await self.git.run("fetch", "--quiet", "origin", self.git.branch)
            head, new = await self.git.head(), await self.git.resolve(f"origin/{self.git.branch}")
            if new is None or new == head:
                self._note(True, f"Up to date (version {head[:7]})")
                return "uptodate"
            if new == self.failed:
                self._note(False, f"Version {new[:7]} failed its tests; waiting for a newer one")
                return "skipped"
            code, _ = await self.git.run("merge-base", "--is-ancestor", head, new, check=False)
            if code:
                self._note(False, "This checkout has its own commits: not updating it automatically")
                return "diverged"
            if (await self.git.text("status", "--porcelain", "--untracked-files=no")).strip():
                self._note(False, "This checkout has local changes: not updating it automatically")
                return "dirty"
            ok, summary = await self._tests_pass(new)
            if not ok:
                self.failed = new
                self._note(False, f"Version {new[:7]} failed its tests ({summary}); keeping {head[:7]}")
                return "failed"
            await self.git.run("merge", "--ff-only", "--quiet", new)
            sync = await asyncio.create_subprocess_exec("uv", "sync", "--frozen", cwd=self.git.dir)
            await sync.wait()
            self._note(True, f"Updated to version {new[:7]} ({summary}); restarting")
            self.restart()
            return "updated"

    async def update_board(self, status: dict[str, Any] | None = None) -> bool:
        """Tell the board to update if its firmware differs from this version."""
        status = status or self.board.status
        if not status.get("online"):
            return False
        head = await self.git.head()
        board_sha = await self.git.resolve(str(status.get("sha") or "")) if status.get("sha") else None
        if board_sha == head or (board_sha and not await self.git.board_changed(board_sha, head)):
            return False
        url = f"{self.public_url}/board/{head}"
        log.info("Board %s: updating to %s", status.get("sha", "?")[:7], head[:7])
        return await self.board.ota(head, url)

    async def run(self) -> None:
        while True:
            if self.auto and self.online():
                try:
                    await self.check()
                except Exception as e:  # git or network trouble: try again next time
                    self._note(False, f"Update check failed: {e}")
            await asyncio.sleep(self.every_s)
