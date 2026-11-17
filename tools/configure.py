"""Fill in the teacher PC's .env by asking questions (used by ./install.sh).

    uv run tools/configure.py          first time: asks everything; then only what's missing
    uv run tools/configure.py --all    asks everything again (Enter keeps the current value)

.env holds this PC's secrets: git ignores it and it's readable only by you (mode 600). Secrets are
typed without echo and never printed back (only their last characters, to recognise them).
Other teachers' PCs and Vercel must share the same system key; each classroom has its own DuckDNS
name. deploy/setup.sh adds the MQTT passwords later.
"""

from __future__ import annotations

import argparse
import getpass
import os
import re
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT))

from pianocore.crypto import Keys, new_system_key  # noqa: E402

Ask = Callable[[str], str]


# ---- .env as a file to edit ----------------------------------------------------------------------
class EnvFile:
    """KEY=value lines, edited in place: comments, order and other lines are kept."""

    def __init__(self, path: Path, template: Path | None = None):
        self.path = path
        self.existed = path.is_file()
        source = path if self.existed else template
        self.lines = source.read_text().splitlines() if source and source.is_file() else []

    def get(self, key: str) -> str:
        for line in reversed(self.lines):
            k, sep, v = line.partition("=")
            if sep and k.strip() == key and not line.lstrip().startswith("#"):
                v = v.strip()
                return v[1:-1] if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"" else v
        return ""

    def set(self, key: str, value: str) -> None:
        if "\n" in value or "\r" in value:
            raise ValueError(f"{key} can't contain a line break")
        for i, line in enumerate(self.lines):
            if line.partition("=")[0].strip() == key and not line.lstrip().startswith("#"):
                self.lines[i] = f"{key}={value}"
                return
        self.lines.append(f"{key}={value}")

    def save(self) -> None:
        """Written as mode 600 from the start (never readable by others, not even for a moment)."""
        fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write("\n".join(self.lines) + "\n")
        os.chmod(self.path, 0o600)


# ---- The questions -------------------------------------------------------------------------------
@dataclass(frozen=True)
class Question:
    key: str
    text: str  # what to type, and where to get it
    secret: bool = False
    required: bool = True  # asked again on every run while empty
    check: Callable[[str], str] | None = None  # the value to store, or raises ValueError

    def clean(self, value: str) -> str:
        value = value.strip()
        return self.check(value) if self.check and value else value


def _system_key(value: str) -> str:
    Keys.from_text(value)  # raises ValueError with the reason
    return value


def _duckdns_name(value: str) -> str:
    name = value.lower().removeprefix("https://").removesuffix("/").removesuffix(".duckdns.org")
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?", name):
        raise ValueError("just the name: letters, digits and hyphens (e.g. piano-aula3)")
    return name


def _duckdns_token(value: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", value.lower()):
        raise ValueError("a DuckDNS token looks like 1a2b3c4d-1a2b-1a2b-1a2b-1a2b3c4d5e6f")
    return value.lower()


def _mongodb_uri(value: str) -> str:
    if not value.startswith(("mongodb://", "mongodb+srv://")):
        raise ValueError("it starts with mongodb+srv:// (Atlas: Connect → Drivers)")
    return value


def _ably_key(value: str) -> str:
    if not re.fullmatch(r"[\w-]+\.[\w-]+:\S+", value):
        raise ValueError("an Ably API key looks like appId.keyId:secret")
    return value


QUESTIONS = [
    Question(
        "PIANO_DATA_KEY",
        "The system key, which encrypts all the data. Paste the one the other teachers' PCs and "
        "Vercel use (ask whoever runs the system), or leave it empty to start a NEW system",
        secret=True,
        check=_system_key,
    ),
    Question(
        "DUCKDNS_DOMAIN",
        "This classroom's DuckDNS name (https://www.duckdns.org: sign in and add one; each "
        "classroom needs its own), e.g. piano-aula3",
        check=_duckdns_name,
    ),
    Question(
        "DUCKDNS_TOKEN",
        "Your DuckDNS token (top of duckdns.org once signed in)",
        secret=True,
        check=_duckdns_token,
    ),
    Question("WIFI_SSID", "The classroom router's WiFi name (the board and this PC join it)"),
    Question("WIFI_PASSWORD", "Its password (empty for an open network)", secret=True, required=False),
    Question(
        "MONGODB_URI",
        "MongoDB Atlas connection string, to sync with the online site (empty: this class works "
        "offline only)",
        secret=True,
        required=False,
        check=_mongodb_uri,
    ),
    Question(
        "ABLY_API_KEY",
        "Ably API key, for online lessons and relaying the class (empty: none)",
        secret=True,
        required=False,
        check=_ably_key,
    ),
]


def shown(value: str, secret: bool) -> str:
    if not value:
        return "empty"
    return f"…{value[-4:]}" if secret else value


def ask_one(q: Question, current: str, ask: Ask, ask_secret: Ask, say: Callable[[str], None]) -> str:
    """Asks until the answer is valid. Enter keeps the current value."""
    hint = f" [Enter keeps {shown(current, q.secret)}]" if current else ""
    while True:
        say(f"\n{q.text}.")
        answer = (ask_secret if q.secret else ask)(f"{q.key}{hint}: ")
        if not answer.strip():
            if current or not q.required or q.key == "PIANO_DATA_KEY":
                return current
            say("   This one is needed.")
            continue
        try:
            return q.clean(answer)
        except ValueError as e:
            say(f"   That doesn't look right: {e}.")


def configure(
    env: EnvFile,
    everything: bool,
    ask: Ask = input,
    ask_secret: Ask = getpass.getpass,
    say: Callable[[str], None] = print,
) -> list[str]:
    """Asks the questions that are due and writes the answers into env. Returns what changed."""
    first_time = not env.existed
    changed = []
    for q in QUESTIONS:
        current = env.get(q.key)
        if q.key == "WIFI_PASSWORD":
            due = everything or first_time or "WIFI_SSID" in changed  # asked with its network's name
        else:
            due = everything or first_time or (q.required and not current)
        if not due:
            continue
        value = ask_one(q, current, ask, ask_secret, say)
        if q.key == "PIANO_DATA_KEY" and not value:
            value = new_system_key()
            say(
                "   Created a new system key. Put the same PIANO_DATA_KEY on Vercel and on every other "
                "teacher's PC (it's in .env), and keep a copy: data sealed with a lost key is gone."
            )
        if value != current:
            env.set(q.key, value)
            changed.append(q.key)
    if "DUCKDNS_DOMAIN" in changed and env.get("PIANO_PUBLIC_URL").endswith(".duckdns.org"):
        env.set("PIANO_PUBLIC_URL", "")  # the old name: now it follows DUCKDNS_DOMAIN (fog/settings.py)
        changed.append("PIANO_PUBLIC_URL")
    if not env.get("PIANO_BOARD_ID"):
        env.set("PIANO_BOARD_ID", "piano1")
        changed.append("PIANO_BOARD_ID")
    return changed


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--all", action="store_true", help="ask everything again (Enter keeps a value)")
    ap.add_argument("--env", type=Path, default=PROJECT / ".env", help=argparse.SUPPRESS)
    args = ap.parse_args()
    env = EnvFile(args.env, template=PROJECT / ".env.example")
    try:
        changed = configure(env, args.all)
    except (EOFError, KeyboardInterrupt):
        sys.exit("\nStopped: .env not changed.")
    if changed or not env.existed:
        env.save()
        print(f"\n.env saved ({', '.join(changed) or 'no changes'}).")
    else:
        print(".env: nothing missing (tools/configure.py --all to change something).")


if __name__ == "__main__":
    main()
