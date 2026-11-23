"""Users, melodies and sessions in MongoDB Atlas (used by Vercel, and by a teacher PC when it syncs).

Every document holds its record sealed with the system key (``data``); only what queries need
stays in the clear: ids, the owner's id (a keyed hash, not the name), the public flag, the
update time and the tombstone flag. Each collection's documents are typed (the TypedDicts below)
and so are the collections, so every query and write is checked against its document's shape.

Collections: ``users`` (:class:`UserDoc`), ``melodies`` (:class:`MelodyDoc`), ``aliases``
(:class:`AliasDoc`), ``meta`` (:class:`MetaDoc`) and ``sessions`` (:class:`SessionDoc`: Vercel's
sign-in sessions, removed by a TTL index once expired; a teacher PC keeps its own on its board).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from datetime import UTC, datetime
from typing import Any, TypedDict, cast

from bson import Binary
from pymongo import ASCENDING, AsyncMongoClient
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase

from .crypto import Keys
from .models import AuthSession, Melody, User
from .repo import Repo


class UserDoc(TypedDict):
    _id: str  # uid
    updated: int
    deleted: bool
    data: Binary  # the sealed User


class MelodyDoc(TypedDict):
    _id: str  # melody id
    owner: str  # the owner's uid
    public: bool
    updated: int
    deleted: bool
    data: Binary  # the sealed Melody


class AliasDoc(TypedDict):
    _id: str  # the old uid of a renamed account
    data: Binary  # sealed {"uid": new uid}


class MetaDoc(TypedDict):
    _id: str  # name
    data: Binary


class SessionDoc(TypedDict):
    _id: str  # sid: a hash of the token
    user: str  # the account's uid
    expires: datetime  # the TTL index removes the document after this
    data: Binary  # the sealed AuthSession


# Query operators and the filter on the melodies: the fields of MelodyDoc that queries use. MongoDB's
# keys start with "$", so these use TypedDict's functional syntax.
AtLeast = TypedDict("AtLeast", {"$gte": int})
OneOf = TypedDict("OneOf", {"$in": list[str]})
MelodyFilter = TypedDict(
    "MelodyFilter",
    {
        "_id": "str | OneOf",
        "owner": OneOf,
        "public": bool,
        "updated": AtLeast,
        "deleted": bool,
        "$or": "list[MelodyFilter]",
    },
    total=False,
)


def typed_collection[T: Mapping[str, Any]](
    db: AsyncDatabase[dict[str, Any]], name: str, _document: type[T]
) -> AsyncCollection[T]:
    """The collection ``name`` with documents of type ``T``: filters, writes and results are then
    checked against ``T`` (pymongo's collections are generic over their document type)."""
    return cast("AsyncCollection[T]", db.get_collection(name))


class MongoRepo(Repo):
    def __init__(self, client: AsyncMongoClient[dict[str, Any]], keys: Keys, db_name: str = "piano") -> None:
        self.client = client
        self.db = client[db_name]
        self.keys = keys
        self.users = typed_collection(self.db, "users", UserDoc)
        self.melodies = typed_collection(self.db, "melodies", MelodyDoc)
        self.aliases = typed_collection(self.db, "aliases", AliasDoc)
        self.meta = typed_collection(self.db, "meta", MetaDoc)
        self.sessions = typed_collection(self.db, "sessions", SessionDoc)
        self._session_indexes = False

    @classmethod
    def connect(cls, uri: str, keys: Keys, db_name: str = "piano", timeout_ms: int = 8000) -> MongoRepo:
        """A repo on ``uri`` (mongodb+srv://…). The connection opens on first use."""
        client: AsyncMongoClient[dict[str, Any]] = AsyncMongoClient(
            uri, serverSelectionTimeoutMS=timeout_ms, appname="esp32-piano"
        )
        return cls(client, keys, db_name)

    async def ensure_indexes(self) -> None:
        await self.melodies.create_index([("owner", ASCENDING), ("updated", ASCENDING)])
        await self.melodies.create_index([("public", ASCENDING), ("updated", ASCENDING)])
        await self.sessions.create_index([("user", ASCENDING)])
        await self.sessions.create_index([("expires", ASCENDING)], expireAfterSeconds=0)

    async def ping(self) -> None:
        await self.db.command("ping")

    def _seal(self, obj: dict[str, Any], key: str) -> Binary:
        return Binary(self.keys.seal(obj, key))

    def _open(self, data: Binary | bytes, key: str) -> dict[str, Any]:
        return self.keys.open(bytes(data), key)

    # ---- users
    def _user(self, doc: UserDoc) -> User:
        return User.from_dict(self._open(doc["data"], f"u/{doc['_id']}"))

    async def get_user(self, uid: str) -> User | None:
        doc = await self.users.find_one({"_id": uid})
        return self._user(doc) if doc else None

    async def get_users(self, uids: Iterable[str]) -> dict[str, User]:
        return {doc["_id"]: self._user(doc) async for doc in self.users.find({"_id": {"$in": list(uids)}})}

    async def put_user(self, user: User) -> None:
        doc: UserDoc = {
            "_id": user.uid,
            "updated": user.updated,
            "deleted": user.deleted,
            "data": self._seal(user.to_dict(), f"u/{user.uid}"),
        }
        await self.users.replace_one({"_id": user.uid}, doc, upsert=True)

    async def delete_user(self, uid: str) -> None:
        await self.users.delete_one({"_id": uid})

    async def all_users(self) -> list[User]:
        return [self._user(doc) async for doc in self.users.find({})]

    # ---- melodies
    async def _melodies(self, query: MelodyFilter) -> list[Melody]:
        return [
            Melody.from_dict(self._open(doc["data"], f"m/{doc['_id']}"))
            async for doc in self.melodies.find(query)
        ]

    async def get_melody(self, mid: str) -> Melody | None:
        found = await self._melodies({"_id": mid})
        return found[0] if found else None

    async def get_melodies(self, mids: Iterable[str]) -> dict[str, Melody]:
        return {m.id: m for m in await self._melodies({"_id": {"$in": list(mids)}})}

    async def put_melody(self, melody: Melody) -> None:
        doc: MelodyDoc = {
            "_id": melody.id,
            "owner": melody.owner,
            "public": melody.public,
            "updated": melody.updated,
            "deleted": melody.deleted,
            "data": self._seal(melody.to_dict(), f"m/{melody.id}"),
        }
        await self.melodies.replace_one({"_id": melody.id}, doc, upsert=True)

    async def drop_melody(self, mid: str) -> None:
        await self.melodies.delete_one({"_id": mid})

    async def find_melodies(
        self, *, owners: Iterable[str] = (), public: bool = False, since: int = 0, with_deleted: bool = False
    ) -> list[Melody]:
        who: list[MelodyFilter] = [{"owner": {"$in": list(owners)}}]
        if public:
            who.append({"public": True})
        query: MelodyFilter = {"$or": who, "updated": {"$gte": since}}
        if not with_deleted:
            query["deleted"] = False
        return await self._melodies(query)

    # ---- aliases and bookkeeping
    async def get_alias(self, uid: str) -> str | None:
        doc = await self.aliases.find_one({"_id": uid})
        return self._open(doc["data"], f"a/{uid}")["uid"] if doc else None

    async def put_alias(self, old_uid: str, new_uid: str) -> None:
        doc: AliasDoc = {"_id": old_uid, "data": self._seal({"uid": new_uid}, f"a/{old_uid}")}
        await self.aliases.replace_one({"_id": old_uid}, doc, upsert=True)

    async def get_meta(self, name: str) -> dict[str, Any]:
        doc = await self.meta.find_one({"_id": name})
        return self._open(doc["data"], f"x/{name}") if doc else {}

    async def put_meta(self, name: str, value: dict[str, Any]) -> None:
        doc: MetaDoc = {"_id": name, "data": self._seal(value, f"x/{name}")}
        await self.meta.replace_one({"_id": name}, doc, upsert=True)

    # ---- sessions
    def _session(self, doc: SessionDoc) -> AuthSession:
        return AuthSession.from_dict(self._open(doc["data"], f"s/{doc['_id']}"))

    async def get_session(self, sid: str) -> AuthSession | None:
        doc = await self.sessions.find_one({"_id": sid})
        return self._session(doc) if doc else None

    async def put_session(self, session: AuthSession) -> None:
        if not self._session_indexes:  # once per process: sessions expire through a TTL index
            await self.sessions.create_index([("user", ASCENDING)])
            await self.sessions.create_index([("expires", ASCENDING)], expireAfterSeconds=0)
            self._session_indexes = True
        doc: SessionDoc = {
            "_id": session.sid,
            "user": session.uid,
            "expires": datetime.fromtimestamp(session.expires / 1000, UTC),
            "data": self._seal(session.to_dict(), f"s/{session.sid}"),
        }
        await self.sessions.replace_one({"_id": session.sid}, doc, upsert=True)

    async def delete_session(self, sid: str) -> None:
        await self.sessions.delete_one({"_id": sid})

    async def sessions_of(self, uid: str) -> list[AuthSession]:
        return [self._session(doc) async for doc in self.sessions.find({"user": uid})]
