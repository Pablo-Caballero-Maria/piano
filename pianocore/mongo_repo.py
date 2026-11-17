"""Users and melodies in MongoDB Atlas (used by Vercel, and by a teacher PC when it syncs).

Every document holds its record sealed with the system key (``data``); only what queries need
stays in the clear: ids, the owner's id (a keyed hash, not the name), the public flag, the
update time and the tombstone flag.

Collections: ``users`` {_id: uid, updated, deleted, data}, ``melodies`` {_id: id, owner, public,
updated, deleted, data}, ``aliases`` {_id: old uid, data}, ``meta`` {_id: name, data}.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from bson import Binary
from pymongo import ASCENDING, AsyncMongoClient

from .crypto import Keys
from .models import Melody, User
from .repo import Repo


class MongoRepo(Repo):
    def __init__(self, client: AsyncMongoClient, keys: Keys, db_name: str = "piano") -> None:
        self.client = client
        self.db = client[db_name]
        self.keys = keys

    @classmethod
    def connect(cls, uri: str, keys: Keys, db_name: str = "piano", timeout_ms: int = 8000) -> MongoRepo:
        """A repo on ``uri`` (mongodb+srv://…). The connection opens on first use."""
        client = AsyncMongoClient(uri, serverSelectionTimeoutMS=timeout_ms, appname="esp32-piano")
        return cls(client, keys, db_name)

    async def ensure_indexes(self) -> None:
        await self.db.melodies.create_index([("owner", ASCENDING), ("updated", ASCENDING)])
        await self.db.melodies.create_index([("public", ASCENDING), ("updated", ASCENDING)])

    async def ping(self) -> None:
        await self.db.command("ping")

    def _seal(self, obj: dict[str, Any], key: str) -> Binary:
        return Binary(self.keys.seal(obj, key))

    def _open(self, doc: dict[str, Any] | None, key: str) -> dict[str, Any] | None:
        return self.keys.open(bytes(doc["data"]), key) if doc else None

    # ---- users
    async def get_user(self, uid: str) -> User | None:
        d = self._open(await self.db.users.find_one({"_id": uid}), f"u/{uid}")
        return User.from_dict(d) if d else None

    async def get_users(self, uids: Iterable[str]) -> dict[str, User]:
        out = {}
        async for doc in self.db.users.find({"_id": {"$in": list(uids)}}):
            d = self._open(doc, f"u/{doc['_id']}")
            if d:
                out[doc["_id"]] = User.from_dict(d)
        return out

    async def put_user(self, user: User) -> None:
        doc = {
            "updated": user.updated,
            "deleted": user.deleted,
            "data": self._seal(user.to_dict(), f"u/{user.uid}"),
        }
        await self.db.users.replace_one({"_id": user.uid}, doc, upsert=True)

    async def delete_user(self, uid: str) -> None:
        await self.db.users.delete_one({"_id": uid})

    async def all_users(self) -> list[User]:
        return list(
            (await self.get_users([d["_id"] async for d in self.db.users.find({}, {"_id": 1})])).values()
        )

    # ---- melodies
    async def _melodies(self, query: dict[str, Any]) -> list[Melody]:
        out = []
        async for doc in self.db.melodies.find(query):
            d = self._open(doc, f"m/{doc['_id']}")
            if d:
                out.append(Melody.from_dict(d))
        return out

    async def get_melody(self, mid: str) -> Melody | None:
        found = await self._melodies({"_id": mid})
        return found[0] if found else None

    async def get_melodies(self, mids: Iterable[str]) -> dict[str, Melody]:
        return {m.id: m for m in await self._melodies({"_id": {"$in": list(mids)}})}

    async def put_melody(self, melody: Melody) -> None:
        doc = {
            "owner": melody.owner,
            "public": melody.public,
            "updated": melody.updated,
            "deleted": melody.deleted,
            "data": self._seal(melody.to_dict(), f"m/{melody.id}"),
        }
        await self.db.melodies.replace_one({"_id": melody.id}, doc, upsert=True)

    async def drop_melody(self, mid: str) -> None:
        await self.db.melodies.delete_one({"_id": mid})

    async def find_melodies(
        self, *, owners: Iterable[str] = (), public: bool = False, since: int = 0, with_deleted: bool = False
    ) -> list[Melody]:
        who: list[dict[str, Any]] = [{"owner": {"$in": list(owners)}}]
        if public:
            who.append({"public": True})
        query: dict[str, Any] = {"$or": who, "updated": {"$gte": since}}
        if not with_deleted:
            query["deleted"] = False
        return await self._melodies(query)

    # ---- aliases and bookkeeping
    async def get_alias(self, uid: str) -> str | None:
        d = self._open(await self.db.aliases.find_one({"_id": uid}), f"a/{uid}")
        return d["uid"] if d else None

    async def put_alias(self, old_uid: str, new_uid: str) -> None:
        doc = {"data": self._seal({"uid": new_uid}, f"a/{old_uid}")}
        await self.db.aliases.replace_one({"_id": old_uid}, doc, upsert=True)

    async def get_meta(self, name: str) -> dict[str, Any]:
        return self._open(await self.db.meta.find_one({"_id": name}), f"x/{name}") or {}

    async def put_meta(self, name: str, value: dict[str, Any]) -> None:
        await self.db.meta.replace_one({"_id": name}, {"data": self._seal(value, f"x/{name}")}, upsert=True)
