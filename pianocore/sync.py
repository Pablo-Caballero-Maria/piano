"""Keeping a classroom board and MongoDB Atlas in step (run by the teacher's PC when it's online).

What a board keeps: the accounts of its class (everyone who has used this PC), their melodies,
and as many public melodies as fit. Atlas keeps everything.

Each run, for records changed since the previous run:

1. Users of the class: the newest copy wins. A *pending* account (signed up while the PC was
   offline) whose name was taken in Atlas meanwhile is renamed (``ana`` → ``ana-2``); its old
   name keeps logging in through an alias, and the user is told once.
2. Melodies of the class and public ones changed here go up when newer than Atlas's copy.
3. Those changed in Atlas come down when newer; someone else's public melodies only while the
   board has room. A public melody that became private or was deleted is dropped from the board.
4. Old tombstones (deleted melodies) that Atlas already has are purged from the board.

Conflicts between edits are settled by ``updated`` (newest wins); every melody records who edited
it last.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .crypto import Keys
from .models import User, now_ms
from .repo import Repo
from .service import RESERVE_BYTES

TOMBSTONE_DAYS = 30


@dataclass
class SyncReport:
    users_up: int = 0
    users_down: int = 0
    melodies_up: int = 0
    melodies_down: int = 0
    dropped: int = 0
    purged: int = 0
    skipped_no_room: int = 0
    renamed: list[tuple[str, str]] = field(default_factory=list)

    def __str__(self) -> str:
        parts = [
            f"users ↑{self.users_up} ↓{self.users_down}",
            f"melodies ↑{self.melodies_up} ↓{self.melodies_down}",
        ]
        if self.dropped or self.purged:
            parts.append(f"dropped {self.dropped}, purged {self.purged}")
        if self.skipped_no_room:
            parts.append(f"{self.skipped_no_room} public melodies didn't fit on the board")
        parts += [f"renamed {old} → {new}" for old, new in self.renamed]
        return ", ".join(parts)


async def _free_name(local: Repo, remote: Repo, keys: Keys, base: str) -> tuple[str, str]:
    """A username like base-2, base-3… taken neither here nor in Atlas: (name, uid)."""
    for n in range(2, 1000):
        suffix = f"-{n}"
        name = base[: 32 - len(suffix)] + suffix
        uid = keys.user_id(name)
        if await local.get_user(uid) is None and await remote.get_user(uid) is None:
            return name, uid
    raise RuntimeError(f"No free username for {base}")


async def _rename(local: Repo, remote: Repo, keys: Keys, user: User, report: SyncReport) -> None:
    """``user`` signed up offline with a name someone else took in Atlas: give it a new one."""
    name, uid = await _free_name(local, remote, keys, user.username)
    now = now_ms()
    renamed = User.from_dict(
        {
            **user.to_dict(),
            "uid": uid,
            "username": name,
            "pending": False,
            "updated": now,
            "notice": f'The username "{user.username}" was already taken in another class, so yours is now '
            f'"{name}". Your old name still logs you in.',
        }
    )
    await local.put_user(renamed)
    await remote.put_user(renamed)
    for m in await local.find_melodies(owners=[user.uid], with_deleted=True):
        await local.drop_melody(m.id)  # removes the old owner's index entry too
        m.owner, m.owner_name, m.updated = uid, name, now
        if m.edited_by == user.username:
            m.edited_by = name
        await local.put_melody(m)
    await local.delete_user(user.uid)
    await local.put_alias(user.uid, uid)
    await remote.put_alias(user.uid, uid)
    report.renamed.append((user.username, name))


async def _sync_users(local: Repo, remote: Repo, keys: Keys, report: SyncReport) -> list[str]:
    users = await local.all_users()
    remote_users = await remote.get_users([u.uid for u in users])
    for lu in users:
        ru = remote_users.get(lu.uid)
        if lu.pending and ru is not None and not ru.deleted and ru.salt != lu.salt:  # another person's
            await _rename(local, remote, keys, lu, report)
        elif ru is None or lu.updated > ru.updated or (lu.updated == ru.updated and lu.pending):
            lu.pending = False
            await remote.put_user(lu)
            await local.put_user(lu)
            report.users_up += 1
        elif ru.updated > lu.updated:
            await local.put_user(ru)
            report.users_down += 1
    return [u.uid for u in await local.all_users()]


async def sync(local: Repo, remote: Repo, keys: Keys) -> SyncReport:
    """One sync between a board (``local``) and Atlas (``remote``). Raises if Atlas can't be reached."""
    report = SyncReport()
    since = (await local.get_meta("sync")).get("since", 0)
    started = now_ms()
    class_uids = await _sync_users(local, remote, keys, report)
    in_class = set(class_uids)

    # 2. Up: what changed here
    changed = await local.find_melodies(owners=class_uids, public=True, since=since, with_deleted=True)
    theirs = await remote.get_melodies([m.id for m in changed])
    for m in changed:
        if m.id not in theirs or m.updated > theirs[m.id].updated:
            await remote.put_melody(m)
            report.melodies_up += 1

    # 3. Down: what changed in Atlas, newest first (so the newest public melodies get the room)
    changed = await remote.find_melodies(owners=class_uids, public=True, since=since, with_deleted=True)
    changed.sort(key=lambda m: m.updated, reverse=True)
    ours = await local.get_melodies([m.id for m in changed])
    for m in changed:
        mine = ours.get(m.id)
        if mine is not None and mine.updated >= m.updated:
            continue
        if m.owner not in in_class:
            if m.deleted or not m.public:
                if mine is not None:
                    await local.drop_melody(m.id)
                    report.dropped += 1
                continue
            free = await local.free_bytes()
            if mine is None and free is not None and free < RESERVE_BYTES * 2 + len(m.notes):
                report.skipped_no_room += 1
                continue
        await local.put_melody(m)
        report.melodies_down += 1

    # Public copies whose owner (from another class) made them private: drop them
    others = [m for m in await local.find_melodies(public=True) if m.owner not in in_class]
    remote_copies = await remote.get_melodies([m.id for m in others])
    for m in others:
        r = remote_copies.get(m.id)
        if r is None or r.deleted or not r.public:
            await local.drop_melody(m.id)
            report.dropped += 1

    # 4. Old tombstones Atlas already has
    cutoff = started - TOMBSTONE_DAYS * 24 * 3600 * 1000
    old = [
        m
        for m in await local.find_melodies(owners=class_uids, with_deleted=True)
        if m.deleted and m.updated < cutoff
    ]
    remote_copies = await remote.get_melodies([m.id for m in old])
    for m in old:
        if m.id in remote_copies and remote_copies[m.id].updated >= m.updated:
            await local.drop_melody(m.id)
            report.purged += 1

    await local.put_meta("sync", {"since": started, "at": now_ms(), "report": str(report)})
    return report
