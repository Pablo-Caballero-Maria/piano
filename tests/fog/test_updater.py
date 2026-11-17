"""The PC's self-update from GitHub, against throwaway git repositories."""

import subprocess

import pytest

from fog.updater import Git, Updater, board_path


def sh(*args, cwd):
    return subprocess.run(args, cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


@pytest.fixture
def repos(tmp_path):
    """origin (bare), a "teacher PC" clone, and a "developer" clone that pushes."""
    origin = tmp_path / "origin.git"
    sh("git", "init", "--bare", "-b", "main", str(origin), cwd=tmp_path)
    dev = tmp_path / "dev"
    sh("git", "clone", "-q", str(origin), str(dev), cwd=tmp_path)
    for k, v in (("user.email", "t@t"), ("user.name", "t")):
        sh("git", "config", k, v, cwd=dev)
    (dev / "esp32").mkdir()
    (dev / "esp32" / "app.py").write_text("A = 1\n")
    (dev / "README.md").write_text("hi\n")
    sh("git", "add", "-A", cwd=dev)
    sh("git", "commit", "-qm", "first", cwd=dev)
    sh("git", "push", "-q", "origin", "main", cwd=dev)
    pc = tmp_path / "pc"
    sh("git", "clone", "-q", str(origin), str(pc), cwd=tmp_path)
    return dev, pc


def push(dev, path, text):
    (dev / path).write_text(text)
    sh("git", "commit", "-qam", "change " + path, cwd=dev)
    sh("git", "push", "-q", "origin", "main", cwd=dev)
    return sh("git", "rev-parse", "HEAD", cwd=dev)


class FakeBoard:
    def __init__(self, sha):
        self.status = {"online": True, "sha": sha}
        self.ota_calls = []

    async def ota(self, sha, url):
        self.ota_calls.append((sha, url))
        return True


def updater(pc, tests_pass=True, board=None):
    restarted = []
    u = Updater(
        Git(pc),
        board or FakeBoard(None),
        online=lambda: True,
        public_url="https://pc",
        test_commands=[["true" if tests_pass else "false"]],
        restart=lambda: restarted.append(1),
    )
    u.restarted = restarted
    return u


async def test_a_tested_new_version_is_installed(repos):
    dev, pc = repos
    u = updater(pc)
    assert await u.check() == "uptodate"
    new = push(dev, "README.md", "new\n")
    assert await u.check() == "updated"
    assert sh("git", "rev-parse", "HEAD", cwd=pc) == new and u.restarted == [1]


async def test_a_version_that_fails_its_tests_is_not(repos):
    dev, pc = repos
    old = sh("git", "rev-parse", "HEAD", cwd=pc)
    u = updater(pc, tests_pass=False)
    push(dev, "README.md", "broken\n")
    assert await u.check() == "failed"
    assert sh("git", "rev-parse", "HEAD", cwd=pc) == old and "failed its tests" in u.last["result"]
    assert await u.check() == "skipped"  # not tested again until there's a newer one


async def test_local_changes_are_left_alone(repos):
    dev, pc = repos
    u = updater(pc)
    (pc / "README.md").write_text("my edit\n")
    push(dev, "esp32/app.py", "A = 2\n")
    assert await u.check() == "dirty"


async def test_the_board_is_told_to_update_only_when_its_files_changed(repos):
    dev, pc = repos
    first = sh("git", "rev-parse", "HEAD", cwd=pc)
    board = FakeBoard(first)
    u = updater(pc, board=board)
    assert await u.update_board() is False  # same version
    push(dev, "README.md", "docs only\n")
    await u.check()
    assert await u.update_board() is False  # newer, but no board file changed
    new = push(dev, "esp32/app.py", "A = 3\n")
    await u.check()
    assert await u.update_board() is True and board.ota_calls == [(new, f"https://pc/board/{new}")]
    files = await u.git.board_files(new)
    assert list(files) == ["esp32/app.py"] and files["esp32/app.py"][1] == len("A = 3\n")
    assert await u.git.show(new, "esp32/app.py") == b"A = 3\n"


def test_board_paths_match_the_board():
    import updater as board_updater  # esp32/updater.py

    for path in (
        "esp32/app.py",
        "esp32/ca.pem",
        "esp32/x/y.py",
        "tests/board/t.py",
        "web/public/a.js",
        "README.md",
    ):
        assert board_path(path) == board_updater.board_path(path)


async def test_fetching_from_a_url_instead_of_origin(repos):
    """The service fetches the public repository by URL (no SSH key); same result."""
    dev, pc = repos
    origin = sh("git", "remote", "get-url", "origin", cwd=pc)
    sh("git", "remote", "set-url", "origin", "git@example.invalid:nowhere.git", cwd=pc)  # unusable remote
    u = Updater(
        Git(pc, url=origin),
        FakeBoard(None),
        online=lambda: True,
        public_url="https://pc",
        test_commands=[["true"]],
        restart=lambda: None,
    )
    new = push(dev, "README.md", "via url\n")
    assert await u.check() == "updated"
    assert sh("git", "rev-parse", "HEAD", cwd=pc) == new
