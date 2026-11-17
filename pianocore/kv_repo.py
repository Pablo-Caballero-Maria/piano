"""Users and melodies in a key/value store: a classroom board's flash, reached over MQTT by the PC.

The board only stores bytes under string keys; it can't read them (every value is sealed with
the system key, which it doesn't have). Keys:

========================  ====================================================
``u/<uid>``               a user (sealed)
``m/<id>``                a melody (sealed)
``o/<owner uid>/<id>``    index: the melodies of each owner (empty value)
``p/<id>``                index: public melodies (empty value)
``a/<old uid>``           a renamed account: the new uid (sealed)
``x/<name>``              bookkeeping, e.g. the last sync (sealed)
========================  ====================================================

Index entries stay for tombstones, so a sync still finds deletions.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any, Protocol

from .crypto import Keys
from .models import Melody, User
from .repo import Repo, matches


class KV(Protocol):
    """A key/value store of bytes (the board's protocol, see fog/board.py and esp32/kv.py)."""

    async def get(self, key: str) -> bytes | None: ...

    async def get_many(self, keys: list[str]) -> dict[str, bytes]: ...

    async def put(self, key: str, value: bytes) -> None: ...

    async def delete(self, key: str) -> None: ...

    async def keys(self, prefix: str) -> list[str]: ...

    async def free(self) -> int: ...


class MemoryKV:
    """A KV in a dict, for tests."""

    def __init__(self, capacity: int = 2_000_000) -> None:
        self.data: dict[str, bytes] = {}
        self.capacity = capacity

    async def get(self, key: str) -> bytes | None:
        return self.data.get(key)

    async def get_many(self, keys: list[str]) -> dict[str, bytes]:
        return {k: self.data[k] for k in keys if k in self.data}

    async def put(self, key: str, value: bytes) -> None:
        self.data[key] = bytes(value)

    async def delete(self, key: str) -> None:
        self.data.pop(key, None)

    async def keys(self, prefix: str) -> list[str]:
        return sorted(k for k in self.data if k.startswith(prefix))

    async def free(self) -> int:
        return self.capacity - sum(len(k) + len(v) for k, v in self.data.items())


class KVRepo(Repo):
    def __init__(self, kv: KV, keys: Keys) -> None:
        self.kv = kv
        self.keys = keys

    async def _get(self, key: str) -> dict[str, Any] | None:
        blob = await self.kv.get(key)
        return self.keys.open(blob, key) if blob is not None else None

    async def _put(self, key: str, obj: dict[str, Any]) -> None:
        await self.kv.put(key, self.keys.seal(obj, key))

    # ---- users
    async def get_user(self, uid: str) -> User | None:
        d = await self._get(f"u/{uid}")
        return User.from_dict(d) if d else None

    async def put_user(self, user: User) -> None:
        await self._put(f"u/{user.uid}", user.to_dict())

    async def delete_user(self, uid: str) -> None:
        await self.kv.delete(f"u/{uid}")

    async def all_users(self) -> list[User]:
        keys = await self.kv.keys("u/")
        blobs = await self.kv.get_many(keys)
        return [User.from_dict(self.keys.open(blobs[k], k)) for k in keys if k in blobs]

    # ---- melodies
    async def get_melody(self, mid: str) -> Melody | None:
        d = await self._get(f"m/{mid}")
        return Melody.from_dict(d) if d else None

    async def get_melodies(self, mids: Iterable[str]) -> dict[str, Melody]:
        keys = [f"m/{mid}" for mid in mids]
        blobs = await self.kv.get_many(keys)
        return {k[2:]: Melody.from_dict(self.keys.open(blobs[k], k)) for k in keys if k in blobs}

    async def put_melody(self, melody: Melody) -> None:
        await self._put(f"m/{melody.id}", melody.to_dict())
        await self.kv.put(f"o/{melody.owner}/{melody.id}", b"")
        if melody.public:
            await self.kv.put(f"p/{melody.id}", b"")
        else:
            await self.kv.delete(f"p/{melody.id}")

    async def drop_melody(self, mid: str) -> None:
        m = await self.get_melody(mid)
        await self.kv.delete(f"m/{mid}")
        await self.kv.delete(f"p/{mid}")
        if m is not None:
            await self.kv.delete(f"o/{m.owner}/{mid}")

    async def find_melodies(
        self, *, owners: Iterable[str] = (), public: bool = False, since: int = 0, with_deleted: bool = False
    ) -> list[Melody]:
        owner_set = set(owners)
        ids: set[str] = set()
        for owner in owner_set:
            ids.update(k.rsplit("/", 1)[1] for k in await self.kv.keys(f"o/{owner}/"))
        if public:
            ids.update(k[2:] for k in await self.kv.keys("p/"))
        found = await self.get_melodies(sorted(ids))
        return [m for m in found.values() if matches(m, owner_set, public, since, with_deleted)]

    # ---- aliases and bookkeeping
    async def get_alias(self, uid: str) -> str | None:
        d = await self._get(f"a/{uid}")
        return d["uid"] if d else None

    async def put_alias(self, old_uid: str, new_uid: str) -> None:
        await self._put(f"a/{old_uid}", {"uid": new_uid})

    async def get_meta(self, name: str) -> dict[str, Any]:
        return await self._get(f"x/{name}") or {}

    async def put_meta(self, name: str, value: dict[str, Any]) -> None:
        await self._put(f"x/{name}", value)

    async def free_bytes(self) -> int | None:
        return await self.kv.free()
