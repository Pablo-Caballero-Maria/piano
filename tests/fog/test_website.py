"""The website the PC serves (fog/website.py): the built site, its cache headers, updates."""

import json
import os
import re
import time

from fastapi.testclient import TestClient

from fog import security, website
from fog.app import Fog, create_app
from fog.settings import REPO_DIR, Settings
from fog.simboard import SimulatedBoard
from pianocore.crypto import new_system_key


def build_site(repo):
    """What `npm run build` leaves in web/out (just enough of it)."""
    out = repo / website.BUILT
    (out / "_next" / "static" / "chunks").mkdir(parents=True)
    (out / "index.html").write_text("<!doctype html><title>ESP32 Piano</title>")
    (out / "404.html").write_text("not here")
    (out / "_next" / "static" / "chunks" / "app-1a2b.js").write_text("console.log(1)")
    return out


def client_for(repo, tmp_path):
    (tmp_path / "board").mkdir(exist_ok=True)
    board = SimulatedBoard(tmp_path / "board")
    settings = Settings(data_key=new_system_key(), repo_dir=repo, auto_update=False)
    fog = Fog.build(settings, board=board.link)
    return TestClient(create_app(settings, fog, background=False)), board


def test_the_built_site_is_served_with_cache_headers(tmp_path):
    repo = tmp_path / "repo"
    build_site(repo)
    client, board = client_for(repo, tmp_path)
    with client:
        page = client.get("/")
        assert page.status_code == 200 and "ESP32 Piano" in page.text
        assert page.headers["cache-control"] == "no-cache"  # updates show up at once
        script = client.get("/_next/static/chunks/app-1a2b.js")
        assert script.headers["cache-control"] == "public, max-age=31536000, immutable"
        assert client.get("/nowhere").status_code == 404
        assert client.get("/api/config").json()["mode"] == "classroom"  # the API still wins
    board.close()


CLASSROOM_HEADERS = [
    {"key": "Content-Security-Policy", "value": "default-src 'self'; connect-src 'self' ws: wss:"},
    {"key": "X-Content-Type-Options", "value": "nosniff"},
    {"key": "X-Frame-Options", "value": "DENY"},
]


def test_every_response_has_the_builds_security_headers(tmp_path):
    repo = tmp_path / "repo"
    out = build_site(repo)
    (out / "_server").mkdir()
    (out / security.HEADERS_FILE).write_text(json.dumps(CLASSROOM_HEADERS))
    client, board = client_for(repo, tmp_path)
    with client:
        for path in ("/", "/_next/static/chunks/app-1a2b.js", "/api/config", "/nowhere"):
            headers = client.get(path).headers
            assert headers["content-security-policy"] == CLASSROOM_HEADERS[0]["value"], path
            assert headers["x-content-type-options"] == "nosniff"
            assert headers["x-frame-options"] == "DENY"
        assert client.get("/_server/headers.json").status_code == 404  # private, like the auth bundle

        # A new build brings its own headers, without restarting
        (out / security.HEADERS_FILE).write_text(
            json.dumps([{"key": "X-Frame-Options", "value": "SAMEORIGIN"}])
        )
        os.utime(out / security.HEADERS_FILE, (time.time() + 5, time.time() + 5))
        headers = client.get("/").headers
        assert headers["x-frame-options"] == "SAMEORIGIN" and "content-security-policy" not in headers
    board.close()


def test_a_build_without_security_headers_still_works(tmp_path):
    repo = tmp_path / "repo"
    build_site(repo)
    client, board = client_for(repo, tmp_path)
    with client:
        page = client.get("/")
        assert page.status_code == 200 and "content-security-policy" not in page.headers
    board.close()


def test_unreadable_security_headers_are_skipped(tmp_path):
    path = tmp_path / "headers.json"
    path.write_text("not json")
    assert security.SecurityHeaders(path).current() == []
    path.write_text(json.dumps([{"key": "X-Frame-Options", "value": "DENY"}]))
    os.utime(path, (time.time() + 5, time.time() + 5))
    assert security.SecurityHeaders(path).current() == [(b"x-frame-options", b"DENY")]


def test_without_a_build_a_page_says_how_to_build_it(tmp_path):
    client, board = client_for(tmp_path / "empty", tmp_path)
    with client:
        page = client.get("/")
        assert page.status_code == 200 and "isn't built" in page.text
    board.close()


def test_a_staged_build_replaces_the_live_one(tmp_path):
    repo, worktree = tmp_path / "repo", tmp_path / "worktree"
    build_site(repo)
    (repo / website.BUILT / "index.html").write_text("old")
    assert website.install(repo) is False  # nothing staged
    assert website.stage(worktree, repo) is False  # nothing built there
    build_site(worktree)
    assert website.stage(worktree, repo) is True
    assert (repo / website.BUILT / "index.html").read_text() == "old"  # not yet
    assert website.install(repo) is True
    assert "ESP32 Piano" in (repo / website.BUILT / "index.html").read_text()
    assert not (repo / website.STAGED).exists()


def test_vercel_and_the_pc_serve_the_same_build():
    vercel = json.loads((REPO_DIR / "vercel.json").read_text())
    assert vercel["outputDirectory"] == website.BUILT
    assert "--prefix web" in vercel["buildCommand"] and "--prefix web" in vercel["installCommand"]
    next_config = (REPO_DIR / website.SOURCE / "next.config.ts").read_text()
    assert re.search(r'output: "export"', next_config)
    scripts = json.loads((REPO_DIR / website.SOURCE / "package.json").read_text())["scripts"]
    assert {"build", "test"} <= set(scripts)


def test_commands_are_described_without_uv():
    assert website.describe([*website.NPM, "run", "build", "--prefix", "web"]) == "npm run build --prefix web"
