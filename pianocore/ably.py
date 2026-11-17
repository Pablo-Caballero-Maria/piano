"""Ably: live lessons over the internet.

A lesson is the Ably channel ``class:<teacher>`` (lowercase username). The live teacher publishes
``lesson`` ({live, mode}), ``note`` ({freq, midi}) and ``studio`` ({melody, playhead, playing});
students subscribe, and enter the channel's *presence* with what they're doing ({mode, notes,
detail}), which the teacher sees. Both an online lesson (teacher on the Vercel site) and a
classroom lesson relayed by the teacher's PC (fog/ably_bridge.py) use the same channel.

Browsers never see the API key: Vercel signs *token requests* for logged-in users
(:func:`token_request`), with capabilities by role: a teacher may publish on their own channel;
everyone may subscribe to and enter any lesson.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any
from urllib.parse import quote

import httpx

from .auth import Session

REST = "https://rest.ably.io"
PREFIX = "class:"
TOKEN_TTL_MS = 3600 * 1000


def channel(teacher: str) -> str:
    return PREFIX + teacher.lower()


def split_key(api_key: str) -> tuple[str, str]:
    """``appId.keyId:secret`` → (key name, secret)."""
    name, _, secret = api_key.partition(":")
    if not name or not secret:
        raise ValueError("ABLY_API_KEY must look like appId.keyId:secret")
    return name, secret


def capability(session: Session) -> dict[str, list[str]]:
    cap = {PREFIX + "*": ["subscribe", "presence"]}
    if session.is_teacher:
        cap[channel(session.username)] = ["publish", "subscribe", "presence"]
    return cap


def token_request(
    api_key: str,
    client_id: str,
    cap: dict[str, list[str]],
    ttl_ms: int = TOKEN_TTL_MS,
    now_ms: int | None = None,
    nonce: str | None = None,
) -> dict[str, Any]:
    """A signed Ably TokenRequest the browser exchanges for a token (Ably's documented signing)."""
    key_name, secret = split_key(api_key)
    cap_text = json.dumps(cap, separators=(",", ":"), sort_keys=True)
    timestamp = now_ms if now_ms is not None else int(time.time() * 1000)
    nonce = nonce or os.urandom(16).hex()
    text = "".join(f"{v}\n" for v in (key_name, ttl_ms, cap_text, client_id, timestamp, nonce))
    mac = base64.b64encode(hmac.new(secret.encode(), text.encode(), hashlib.sha256).digest()).decode()
    return {
        "keyName": key_name,
        "ttl": ttl_ms,
        "capability": cap_text,
        "clientId": client_id,
        "timestamp": timestamp,
        "nonce": nonce,
        "mac": mac,
    }


def _auth(api_key: str) -> tuple[str, str]:
    return split_key(api_key)


async def publish(http: httpx.AsyncClient, api_key: str, chan: str, name: str, data: Any) -> None:
    r = await http.post(
        f"{REST}/channels/{quote(chan, safe='')}/messages",
        auth=_auth(api_key),
        json={"name": name, "data": json.dumps(data), "encoding": "json"},
        timeout=10,
    )
    r.raise_for_status()


async def presence(http: httpx.AsyncClient, api_key: str, chan: str) -> list[dict[str, Any]]:
    """Who is in a lesson's channel: [{clientId, data}]."""
    r = await http.get(f"{REST}/channels/{quote(chan, safe='')}/presence", auth=_auth(api_key), timeout=10)
    r.raise_for_status()
    out = []
    for p in r.json():
        data = p.get("data")
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except ValueError:
                data = {}
        out.append({"clientId": p.get("clientId"), "data": data if isinstance(data, dict) else {}})
    return out


async def live_lessons(http: httpx.AsyncClient, api_key: str) -> list[str]:
    """Teachers whose lesson channel is active right now."""
    r = await http.get(
        f"{REST}/channels", params={"prefix": PREFIX, "by": "id"}, auth=_auth(api_key), timeout=10
    )
    r.raise_for_status()
    return sorted(c[len(PREFIX) :] for c in r.json() if isinstance(c, str) and c.startswith(PREFIX))
