# The board's key/value store and its binary protocol (esp32/kv.py).
import struct

import kv
import util


def req(op, rid, arg=b""):
    return bytes([op]) + struct.pack("!H", rid) + arg


def put(store, key, value):
    k = key.encode()
    return store.handle(req(kv.PUT, 7, bytes([len(k)]) + k + value))


def open_store():
    folder = util.temp_dir()
    return folder, kv.Store(folder + "/test.db")


def test_get_put_delete():
    folder, store = open_store()
    try:
        assert store.handle(req(kv.GET, 1, b"u/a")) == b"\x00\x01" + bytes([kv.MISSING])
        assert put(store, "u/a", b"\x00secret\xff") == b"\x00\x07" + bytes([kv.OK])
        assert store.handle(req(kv.GET, 2, b"u/a")) == b"\x00\x02" + bytes([kv.OK]) + b"\x00secret\xff"
        assert store.handle(req(kv.DEL, 3, b"u/a"))[2] == kv.OK
        assert store.handle(req(kv.DEL, 3, b"u/a"))[2] == kv.OK  # deleting twice is fine
        assert store.handle(req(kv.GET, 4, b"u/a"))[2] == kv.MISSING
    finally:
        store.close()
        util.rmtree(folder)


def keys_of(answer):
    more, rest, out = answer[3], answer[4:], []
    while rest:
        n = rest[0]
        out.append(bytes(rest[1 : 1 + n]).decode())
        rest = rest[1 + n :]
    return more, out


def test_keys_by_prefix_in_pages():
    folder, store = open_store()
    try:
        for name in ("o/x/1", "o/x/2", "o/y/1", "p/1", "u/1"):
            put(store, name, b"")
        assert keys_of(store.handle(req(kv.KEYS, 1, b"\x00" + b"o/x/"))) == (0, ["o/x/1", "o/x/2"])
        assert keys_of(store.handle(req(kv.KEYS, 1, b"\x05o/x/1" + b"o/"))) == (0, ["o/x/2", "o/y/1"])
        saved = kv.MAX_ANSWER
        kv.MAX_ANSWER = 13  # two keys per answer
        try:
            assert keys_of(store.handle(req(kv.KEYS, 1, b"\x00o/"))) == (1, ["o/x/1", "o/x/2"])
        finally:
            kv.MAX_ANSWER = saved
    finally:
        store.close()
        util.rmtree(folder)


def test_many_and_info():
    folder, store = open_store()
    try:
        put(store, "m/1", b"one")
        put(store, "m/3", b"three")
        ask = b"".join(bytes([3]) + k for k in (b"m/1", b"m/2", b"m/3"))
        answer = store.handle(req(kv.MANY, 9, ask))
        assert answer[:4] == b"\x00\x09" + bytes([kv.OK, 3])  # all 3 handled; m/2 missing
        assert (
            answer[4:]
            == b"\x03m/1" + struct.pack("!I", 3) + b"one" + b"\x03m/3" + struct.pack("!I", 5) + b"three"
        )
        free, count = struct.unpack("!II", store.handle(req(kv.INFO, 1))[3:])
        assert count == 2 and free > 0
        assert store.handle(req(99, 1))[2] == kv.ERROR
        store.free = lambda: 10**12  # a laptop's disk (the simulated board): capped, not an error
        assert store.handle(req(kv.INFO, 1))[2] == kv.OK
    finally:
        store.close()
        util.rmtree(folder)


def test_data_survives_reopening():
    folder, store = open_store()
    try:
        put(store, "u/a", b"x")
        store.close()
        store = kv.Store(folder + "/test.db")
        assert store.handle(req(kv.GET, 1, b"u/a"))[3:] == b"x"
    finally:
        store.close()
        util.rmtree(folder)
