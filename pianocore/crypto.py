"""The system key and everything derived from it.

Every record stored on a board or in MongoDB Atlas is a sealed blob (AES-256-GCM): a 12-byte
random nonce followed by the ciphertext and its 16-byte tag. The record's own key (e.g. ``u/<id>``)
is bound to it as associated data, so a blob copied under another key doesn't open. Only the
teacher PCs and Vercel hold the system key (``PIANO_DATA_KEY``: 32 random bytes, base64); boards
and Atlas only ever see ciphertext.

Three independent keys are derived from it with HKDF-SHA256, one per purpose: record encryption,
lookup ids (a keyed hash of the username, so stored keys don't reveal names), and session-token
signatures.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from typing import Any

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

NONCE_BYTES = 12


class SealError(ValueError):
    """A blob that doesn't open: wrong key, wrong record key, or damaged."""


def _derive(master: bytes, purpose: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=b"esp32-piano", info=purpose).derive(master)


def new_system_key() -> str:
    """A fresh system key, as the base64 text that goes in ``PIANO_DATA_KEY``."""
    return base64.b64encode(os.urandom(32)).decode()


class Keys:
    """The keys derived from the system key."""

    def __init__(self, master: bytes) -> None:
        if len(master) != 32:
            raise ValueError("The system key must be 32 bytes (base64 in PIANO_DATA_KEY)")
        self._aead = AESGCM(_derive(master, b"records"))
        self._ids = _derive(master, b"ids")
        self.session = _derive(master, b"sessions")

    @classmethod
    def from_text(cls, text: str) -> Keys:
        """Keys from the base64 text of ``PIANO_DATA_KEY``."""
        try:
            master = base64.b64decode(text.strip(), validate=True)
        except ValueError as e:
            raise ValueError("PIANO_DATA_KEY is not valid base64") from e
        return cls(master)

    def seal(self, obj: dict[str, Any], record_key: str) -> bytes:
        """Encrypt a JSON-able dict for storage under ``record_key``."""
        nonce = os.urandom(NONCE_BYTES)
        plain = json.dumps(obj, separators=(",", ":")).encode()
        return nonce + self._aead.encrypt(nonce, plain, record_key.encode())

    def open(self, blob: bytes, record_key: str) -> dict[str, Any]:
        """Decrypt a blob sealed under ``record_key``."""
        try:
            plain = self._aead.decrypt(blob[:NONCE_BYTES], blob[NONCE_BYTES:], record_key.encode())
        except Exception as e:  # InvalidTag, or a blob too short to hold a nonce and tag
            raise SealError(f"Can't open the record {record_key}") from e
        return json.loads(plain)

    def user_id(self, username: str) -> str:
        """The stored id of a username (case-insensitive): a keyed hash, so ids don't reveal names."""
        digest = hmac.new(self._ids, username.lower().encode(), hashlib.sha256).hexdigest()
        return digest[:32]
