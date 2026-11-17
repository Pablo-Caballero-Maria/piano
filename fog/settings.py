"""Settings of the teacher's PC, from environment variables or the ``.env`` file next to the repo.

``.env`` holds secrets (the system key, passwords, tokens): it's in .gitignore and must never be
committed (the repository is public). ``.env.example`` lists every variable.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parent.parent


def load_env_file(path: Path) -> dict[str, str]:
    """KEY=value lines (``#`` comments, optional quotes). No shell expansion."""
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
            v = v[1:-1]
        out[k.strip()] = v
    return out


def public_url(env: Mapping[str, str]) -> str:
    """The PC's address for phones and the board: PIANO_PUBLIC_URL, or else the classroom's DuckDNS
    name (DUCKDNS_DOMAIN)."""
    url = env.get("PIANO_PUBLIC_URL", "").strip()
    name = env.get("DUCKDNS_DOMAIN", "").strip().removesuffix(".duckdns.org")
    if not url and name:
        url = f"https://{name}.duckdns.org"
    return (url or "https://localhost").rstrip("/")


@dataclass(frozen=True)
class Settings:
    data_key: str  # PIANO_DATA_KEY: the system key (base64, 32 bytes)
    board_id: str = "piano1"
    public_url: str = "https://piano-esp32.duckdns.org"
    host: str = "127.0.0.1"  # the app listens here; nginx serves it on 443
    port: int = 8080
    mqtt_host: str = "127.0.0.1"
    mqtt_port: int = 1883  # the broker's loopback listener (the board uses TLS on 8883)
    mqtt_user: str = "fog"
    mqtt_password: str = ""
    mongodb_uri: str = ""  # empty: no sync
    mongodb_db: str = "piano"
    duckdns_domain: str = ""  # e.g. piano-esp32 (empty: don't update DNS)
    duckdns_token: str = ""
    ably_api_key: str = ""  # empty: no bridge to Ably
    repo_dir: Path = REPO_DIR
    update_every_s: int = 3600
    sync_every_s: int = 300
    auto_update: bool = True
    git_url: str = "https://github.com/Pablo-Caballero-Maria/piano.git"  # public: no SSH key needed

    @classmethod
    def load(cls, env_file: Path | None = None) -> Settings:
        env = {**load_env_file(env_file or REPO_DIR / ".env"), **os.environ}

        def get(name: str, default: str = "") -> str:
            return env.get(name, default).strip()

        key = get("PIANO_DATA_KEY")
        if not key:
            raise SystemExit(
                "PIANO_DATA_KEY is not set: run `uv run python -m fog keygen` and put it in .env"
            )
        return cls(
            data_key=key,
            board_id=get("PIANO_BOARD_ID") or "piano1",
            public_url=public_url(env),
            host=get("PIANO_HOST", "127.0.0.1"),
            port=int(get("PIANO_PORT", "8080")),
            mqtt_host=get("MQTT_HOST", "127.0.0.1"),
            mqtt_port=int(get("MQTT_PORT", "1883")),
            mqtt_user=get("MQTT_FOG_USER", "fog"),
            mqtt_password=get("MQTT_FOG_PASSWORD"),
            mongodb_uri=get("MONGODB_URI"),
            mongodb_db=get("MONGODB_DB", "piano"),
            duckdns_domain=get("DUCKDNS_DOMAIN"),
            duckdns_token=get("DUCKDNS_TOKEN"),
            ably_api_key=get("ABLY_API_KEY"),
            update_every_s=int(get("PIANO_UPDATE_EVERY_S", "3600")),
            sync_every_s=int(get("PIANO_SYNC_EVERY_S", "300")),
            auto_update=get("PIANO_AUTO_UPDATE", "1") not in ("0", "false", "no"),
            git_url=get("PIANO_GIT_URL", "https://github.com/Pablo-Caballero-Maria/piano.git"),
        )
