# The board's key/value store: a btree database file on its flash (/piano.db), driven by the
# teacher's PC over MQTT. Values are opaque bytes: the PC seals every record with the system key
# before sending it, so the board never sees (or can leak) accounts or melodies in the clear.
#
# Requests arrive on piano/<board>/kv/req and answers go to piano/<board>/kv/res. Binary, to keep
# encrypted values compact:
#   request:  op (1 byte) | request id (2 bytes) | arguments
#   answer:   request id (2 bytes) | status (1 byte: 0 ok, 1 not found, 2 error) | result
#
#   op  arguments                              result
#   1   GET    key                             the value
#   2   PUT    key length (1) | key | value    -
#   3   DEL    key                             -
#   4   KEYS   after length (1) | after | prefix   more (1) | [key length (1) | key]…
#   5   MANY   [key length (1) | key]…         done (1) | [key length (1) | key | value length (4) | value]…
#   6   INFO   -                               free bytes (4) | number of keys (4)
#
# KEYS lists the keys starting with prefix that sort after `after`, as many as fit in one answer
# (more = 1: ask again from the last one). MANY returns the values of the first `done` requested
# keys (missing ones are left out), as many as fit. Keys are ASCII. See pianocore/kv_repo.py.

import os
import struct

import btree

DB_FILE = "/piano.db"
MAX_ANSWER = 12 * 1024  # bytes of keys/values per answer (one MQTT message in the board's RAM)
GET, PUT, DEL, KEYS, MANY, INFO = 1, 2, 3, 4, 5, 6
OK, MISSING, ERROR = 0, 1, 2


class Store:
    def __init__(self, path=DB_FILE):
        self.path = path
        try:
            self._file = open(path, "r+b")
        except OSError:
            self._file = open(path, "w+b")
        # btree keeps its page cache in C memory: 1 KB pages keep it small
        self.db = btree.open(self._file, pagesize=1024)

    def close(self):
        if self.db is not None:
            self.db.close()
            self._file.close()
            self.db = None

    def flush(self):
        self.db.flush()
        self._file.flush()

    def free(self):
        st = os.statvfs(self.path.rsplit("/", 1)[0] or "/")
        return st[0] * st[3]

    def count(self):
        n = 0
        for _ in self.db:
            n += 1
        return n

    def keys_after(self, prefix, after):
        """Keys starting with prefix, after `after`, up to MAX_ANSWER bytes: (keys, more)."""
        out, size = [], 0
        start = after if after and after > prefix else prefix
        for k in self.db.keys(start):
            if not k.startswith(prefix):
                break
            if k == after:
                continue
            if size + len(k) + 1 > MAX_ANSWER:
                return out, True
            out.append(k)
            size += len(k) + 1
        return out, False

    def handle(self, req):
        """Answer one request (bytes); returns the answer (bytes)."""
        op = req[0]
        rid = req[1:3]
        arg = bytes(req[3:])
        try:
            if op == GET:
                v = self.db.get(arg)
                return rid + (bytes([OK]) + v if v is not None else bytes([MISSING]))
            if op == PUT:
                n = arg[0]
                self.db[arg[1 : 1 + n]] = arg[1 + n :]
                self.flush()
                return rid + bytes([OK])
            if op == DEL:
                if arg in self.db:
                    del self.db[arg]
                    self.flush()
                return rid + bytes([OK])
            if op == KEYS:
                n = arg[0]
                keys, more = self.keys_after(arg[1 + n :], arg[1 : 1 + n])
                return rid + bytes([OK, 1 if more else 0]) + b"".join(bytes([len(k)]) + k for k in keys)
            if op == MANY:
                return rid + bytes([OK]) + self._many(arg)
            if op == INFO:  # (capped to 4 GB: a laptop simulating the board has more than that)
                return rid + bytes([OK]) + struct.pack("!II", min(self.free(), 0xFFFFFFFF), self.count())
            return rid + bytes([ERROR]) + b"unknown op"
        except Exception as e:  # a full flash, a damaged request: report it, don't crash
            return rid + bytes([ERROR]) + repr(e).encode()

    def _many(self, arg):
        parts, size, done, i = [], 0, 0, 0
        while i < len(arg):
            n = arg[i]
            key = arg[i + 1 : i + 1 + n]
            v = self.db.get(key)
            if v is not None:
                if parts and size + len(v) + n + 5 > MAX_ANSWER:
                    break
                parts.append(bytes([n]) + key + struct.pack("!I", len(v)) + v)
                size += len(v) + n + 5
            done += 1
            i += 1 + n
        return bytes([done]) + b"".join(parts)
