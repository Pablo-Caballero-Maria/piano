"""fog/auth_server.py: running Better Auth's server and forwarding /api/auth/* to it (with a stand-in
server: the real one is tested in web/tests/server and end to end by the website's e2e tests)."""

import asyncio
import sys
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI, Request

from fog.auth_server import AuthServer, client_ip, free_port

FAKE = Path(__file__).with_name("fake_auth_server.py")


def make_server(tmp_path: Path, **kw) -> AuthServer:
    port = free_port()
    return AuthServer(
        tmp_path,
        data_key="key",
        accounts_url="http://127.0.0.1:1/internal/accounts",
        public_url="https://piano.example",
        port=port,
        command=[sys.executable, str(FAKE), str(port)],
        restart_delay_s=0.1,
        **kw,
    )


def proxy_app(server: AuthServer) -> FastAPI:
    app = FastAPI()

    @app.api_route("/api/auth/{path:path}", methods=["GET", "POST"])
    async def auth(request: Request):
        return await server.forward(request)

    return app


async def test_starts_forwards_and_restarts(tmp_path):
    server = make_server(tmp_path)
    assert server.available
    server.start()
    try:
        assert await server.ready()
        transport = httpx.ASGITransport(app=proxy_app(server), client=("127.0.0.1", 5000))
        async with httpx.AsyncClient(transport=transport, base_url="https://piano.example") as client:
            r = await client.post(
                "/api/auth/sign-in/username?x=1",
                json={"username": "ana"},
                headers={"x-forwarded-for": "6.6.6.6, 192.168.1.20", "x-forwarded-proto": "https"},
            )
            assert r.status_code == 200
            echo = r.json()
            assert (echo["method"], echo["path"], echo["body"]) == (
                "POST",
                "/api/auth/sign-in/username?x=1",
                '{"username":"ana"}',
            )
            headers = {k.lower(): v for k, v in echo["headers"].items()}
            assert headers["x-forwarded-for"] == "192.168.1.20"  # what nginx added, not the client's
            assert headers["x-forwarded-proto"] == "https"
            assert headers["x-forwarded-host"] == "piano.example"
            assert r.headers.get_list("set-cookie") == ["a=1", "b=2"]  # both cookies survive
            assert r.headers["set-auth-token"] == "tok.sig"
            assert (await client.get("/api/auth/teapot")).status_code == 418

        server.proc.kill()  # it stops: it's started again
        await asyncio.sleep(0.5)
        assert await server.ready()
    finally:
        await server.stop()


async def test_answers_503_while_it_isn_t_running(tmp_path):
    server = make_server(tmp_path)
    transport = httpx.ASGITransport(app=proxy_app(server))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/auth/get-session")
    assert r.status_code == 503 and "starting" in r.json()["error"]
    assert not await server.ready(timeout_s=0.3)
    await server.stop()


async def test_without_the_bundle_it_doesn_t_start(tmp_path, caplog):
    server = AuthServer(tmp_path, data_key="k", accounts_url="u", public_url="https://p")
    assert not server.available
    await server.run()  # returns at once
    assert "isn't built" in caplog.text
    assert server.command[-1].endswith("web/out/_server/auth.mjs")
    assert server.env["PIANO_DATA_KEY"] == "k" and server.env["NODE_ENV"] == "production"
    await server.stop()


@pytest.mark.parametrize(
    ("peer", "forwarded", "expected"),
    [
        ("127.0.0.1", "6.6.6.6, 192.168.1.20", "192.168.1.20"),  # behind nginx: what it added
        ("127.0.0.1", "", "127.0.0.1"),  # the demo, no nginx
        ("192.168.1.30", "6.6.6.6", "192.168.1.30"),  # a phone straight at the app: its own address
    ],
)
def test_the_phone_s_address(peer, forwarded, expected):
    scope = {
        "type": "http",
        "client": (peer, 1234),
        "headers": [(b"x-forwarded-for", forwarded.encode())] if forwarded else [],
    }
    assert client_ip(Request(scope)) == expected
