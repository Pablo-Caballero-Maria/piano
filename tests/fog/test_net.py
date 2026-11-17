"""Ably (token requests, the classroom bridge), DuckDNS and the sync service, without the internet."""

import base64
import hashlib
import hmac
import json

import httpx

from fog.ably_bridge import AblyBridge
from fog.internet import DuckDNS, Internet, duckdns_update, lan_ip
from fog.sync_service import SyncService
from pianocore import ably
from pianocore.auth import Session
from pianocore.repo import MemoryRepo

API_KEY = "app1.key1:secret"


def test_ably_token_request_is_signed_as_ably_documents():
    teacher = Session(uid="u", username="Teach", role="teacher")
    cap = ably.capability(teacher)
    assert cap == {"class:*": ["subscribe", "presence"], "class:teach": ["publish", "subscribe", "presence"]}
    assert ably.capability(Session("u", "ana", "student")) == {"class:*": ["subscribe", "presence"]}
    tr = ably.token_request(API_KEY, "Teach", cap, ttl_ms=1000, now_ms=5, nonce="n")
    text = "app1.key1\n1000\n" + tr["capability"] + "\nTeach\n5\nn\n"
    want = base64.b64encode(hmac.new(b"secret", text.encode(), hashlib.sha256).digest()).decode()
    assert tr["mac"] == want and tr["keyName"] == "app1.key1" and json.loads(tr["capability"]) == cap


async def test_the_bridge_publishes_the_latest_of_each_kind_and_lists_followers():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.raw_path.decode(), request.content))
        if request.url.raw_path.endswith(b"/presence"):
            return httpx.Response(
                200,
                json=[
                    {"clientId": "zoe", "data": json.dumps({"mode": "studio", "notes": [60]})},
                    {"clientId": "teach", "data": {}},
                ],
            )
        return httpx.Response(201, json={})

    bridge = AblyBridge(
        API_KEY, online=lambda: True, http=httpx.AsyncClient(transport=httpx.MockTransport(handler))
    )
    bridge.publish("Teach", "lesson", {"live": True, "mode": "piano"})
    for f in (262, 294, 330):
        bridge.publish("Teach", "note", {"freq": f, "midi": []})
    await bridge._flush()
    posts = [json.loads(body) for method, path, body in calls if method == "POST"]
    assert [p["name"] for p in posts] == ["lesson", "note"] and json.loads(posts[1]["data"])["freq"] == 330
    assert all(path == "/channels/class%3Ateach/messages" for m, path, _ in calls if m == "POST")
    await bridge._poll_presence()
    followers = bridge.followers("Teach")
    assert [(f["name"], f["mode"], f["remote"]) for f in followers] == [("zoe", "studio", True)]
    bridge.publish("Teach", "lesson", {"live": False})
    assert bridge.followers("Teach") == []


async def test_duckdns_points_the_name_at_the_lan_ip():
    seen = []

    def handler(request):
        seen.append(dict(request.url.params))
        return httpx.Response(200, text="OK")

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    assert await duckdns_update(http, "piano-esp32", "tok", "192.168.1.10")
    assert seen[-1] == {"domains": "piano-esp32", "token": "tok", "ip": "192.168.1.10"}
    internet = Internet()
    internet.online = True
    d = DuckDNS("piano-esp32.duckdns.org", "tok", internet, http)
    await d.tick()
    assert d.domain == "piano-esp32" and (d.ip is None or d.ip == lan_ip())


async def test_sync_service_runs_only_when_ready(keys):
    board, atlas = MemoryRepo(), MemoryRepo()
    ready = {"on": False}
    svc = SyncService(board, atlas, keys, ready=lambda: ready["on"])
    assert await svc.once() is False
    ready["on"] = True
    assert await svc.once() is True and svc.last["ok"]
    assert await SyncService(board, None, keys, ready=lambda: True).once() is False
