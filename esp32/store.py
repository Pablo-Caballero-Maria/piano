# Melody storage for the ESP32 piano: user accounts and melodies in a btree
# database file on the board's flash (piano.db). main.py receives requests from
# the web app over Bluetooth and passes them to handle(); requests and responses
# are dicts (JSON on the wire). See README.md, "Storage protocol".
#
# Keys (bytes), with <user> = lowercase username and <id> = 8-digit melody number:
#   u:<user>       -> {"name", "salt", "hash", "t"}   account
#   s:<sha256 tok> -> <user>                          login session
#   i:<user>:<id>  -> {"name", "bpm", "n", "len", "c", "u"}  melody info (for lists)
#   n:<user>:<id>  -> "p:s:d p:s:d ..."               the melody's notes
#   #melody        -> last melody number used

import btree
import hashlib
import json
import os
from binascii import hexlify, unhexlify

DB_FILE = "piano.db"
MAX_USERS = 50
MAX_MELODIES = 100        # per user
MAX_NOTES_TEXT = 16000    # encoded notes, bytes (~1200 notes)
_NAME_OK = set(b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-")
_NOTES_OK = set(b"0123456789.: ")
_HEX_OK = set(b"0123456789abcdef")

_file = None
db = None


class Err(Exception):
    """A request error sent back to the browser: Err(http-like code, message)."""


def open_db():
    """Open (or create) the database file. Call once at startup, and close_db() on exit."""
    global _file, db
    try:
        _file = open(DB_FILE, "r+b")
    except OSError:
        _file = open(DB_FILE, "w+b")
    # btree keeps its page cache in the C heap, which Bluetooth also needs: 1 KB pages
    # use ~23 KB of it (the default ~40 KB). It's only freed by close_db().
    db = btree.open(_file, pagesize=1024)


def close_db():
    global _file, db
    if db is not None:
        db.close()
        _file.close()
        db = _file = None


def _commit():
    db.flush()
    _file.flush()


def _hex(b):
    return hexlify(b).decode()


def _sha(*parts):
    h = hashlib.sha256()
    for p in parts:
        h.update(p)
    return h.digest()


def _count(prefix):
    """Number of keys that start with prefix (prefix ends in ':')."""
    end = prefix[:-1] + b";"  # ';' sorts right after ':'
    n = 0
    for _ in db.keys(prefix, end):
        n += 1
    return n


def free_kb():
    st = os.statvfs("/")
    return st[0] * st[3] // 1024


def _username(req):
    name = req.get("user")
    if not isinstance(name, str) or not 3 <= len(name) <= 32 or any(c not in _NAME_OK for c in name.encode()):
        raise Err(400, "The username must be 3-32 letters, digits, _ . or -")
    return name


def _key(req):
    # The browser never sends the password: it sends PBKDF2(password), 64 hex digits
    key = req.get("key")
    if not isinstance(key, str) or len(key) != 64 or any(c not in _HEX_OK for c in key.encode()):
        raise Err(400, "Bad password key")
    return key.encode()


def _new_session(lower):
    tok = _hex(os.urandom(16))
    db[b"s:" + _hex(_sha(tok.encode())).encode()] = lower
    return tok


def _session_key(req):
    tok = req.get("tok")
    if not isinstance(tok, str) or len(tok) != 32:
        raise Err(401, "Log in first")
    return b"s:" + _hex(_sha(tok.encode())).encode()


def _user(req):
    """The logged-in user's lowercase name (bytes), or a 401."""
    lower = db.get(_session_key(req))
    if not lower or (b"u:" + lower) not in db:
        raise Err(401, "Log in first")
    return lower


def _public(lower):
    return {"username": json.loads(db[b"u:" + lower])["name"]}


def _melody_id(req):
    mid = req.get("mid")
    if not isinstance(mid, str) or len(mid) != 8 or not mid.isdigit():
        raise Err(404, "Melody not found")
    return mid.encode()


def _parse_melody(req, t):
    """Validate {name, bpm, notes, length} from a create/update request."""
    m = req.get("melody")
    if not isinstance(m, dict):
        raise Err(400, "Missing melody")
    name = m.get("name")
    name = " ".join(name.split()) if isinstance(name, str) else ""
    if not 1 <= len(name) <= 80:
        raise Err(400, "The name must be 1-80 characters")
    bpm = m.get("bpm")
    if not isinstance(bpm, (int, float)) or not 20 <= bpm <= 400:
        raise Err(400, "The tempo must be 20-400 BPM")
    notes = m.get("notes")
    if not isinstance(notes, str):
        raise Err(400, "Bad notes")
    nb = notes.encode()
    if len(nb) > MAX_NOTES_TEXT:
        raise Err(400, "Too many notes for the ESP32 (max about 1200)")
    for c in nb:
        if c not in _NOTES_OK:
            raise Err(400, "Bad notes")
    length = m.get("length")
    if not isinstance(length, (int, float)) or length < 0:
        length = 0
    info = {"name": name, "bpm": bpm, "n": nb.count(b":") // 2, "len": length, "c": t, "u": t}
    return info, nb


def _info_out(mid, info):
    return {"id": mid.decode(), "name": info["name"], "bpm": info["bpm"], "noteCount": info["n"],
            "length": info["len"], "createdAt": info["c"], "updatedAt": info["u"]}


# ---- Operations: each takes the request dict and the browser's clock (ms) -------
def op_hello(req, t):
    return {"version": 1, "free": free_kb(), "users": _count(b"u:")}


def op_register(req, t):
    name, key = _username(req), _key(req)
    lower = name.lower().encode()
    if (b"u:" + lower) in db:
        raise Err(409, "That username is already taken")
    if _count(b"u:") >= MAX_USERS:
        raise Err(400, "This ESP32 already has %d accounts" % MAX_USERS)
    salt = os.urandom(16)
    db[b"u:" + lower] = json.dumps({"name": name, "salt": _hex(salt), "hash": _hex(_sha(salt, key)), "t": t})
    tok = _new_session(lower)
    _commit()
    return {"user": {"username": name}, "tok": tok}


def op_login(req, t):
    name, key = _username(req), _key(req)
    lower = name.lower().encode()
    raw = db.get(b"u:" + lower)
    u = json.loads(raw) if raw else None
    if not u or _hex(_sha(unhexlify(u["salt"]), key)) != u["hash"]:
        raise Err(401, "Wrong username or password")
    tok = _new_session(lower)
    _commit()
    return {"user": {"username": u["name"]}, "tok": tok}


def op_logout(req, t):
    try:
        k = _session_key(req)
    except Err:
        return {}
    if k in db:
        del db[k]
        _commit()
    return {}


def op_me(req, t):
    try:
        return {"user": _public(_user(req))}
    except Err:
        return {"user": None}


def op_list(req, t):
    lower = _user(req)
    prefix = b"i:" + lower + b":"
    out = []
    for k, v in db.items(prefix, b"i:" + lower + b";"):
        i = json.loads(v)
        # compact rows: [id, name, bpm, noteCount, length, updatedAt]
        out.append([k[len(prefix):].decode(), i["name"], i["bpm"], i["n"], i["len"], i["u"]])
    out.sort(key=lambda r: r[5], reverse=True)
    return {"melodies": out, "free": free_kb()}


def op_get(req, t):
    lower, mid = _user(req), _melody_id(req)
    raw = db.get(b"i:" + lower + b":" + mid)
    if not raw:
        raise Err(404, "Melody not found")
    out = _info_out(mid, json.loads(raw))
    out["notes"] = db[b"n:" + lower + b":" + mid].decode()
    return {"melody": out}


def op_create(req, t):
    lower = _user(req)
    info, notes = _parse_melody(req, t)
    if _count(b"i:" + lower + b":") >= MAX_MELODIES:
        raise Err(400, "You can keep at most %d melodies on the ESP32; delete some first" % MAX_MELODIES)
    if len(notes) + 4096 > free_kb() * 1024:
        raise Err(507, "The ESP32's memory is full")
    n = int(db.get(b"#melody", b"0").decode()) + 1
    mid = ("%08d" % n).encode()
    db[b"#melody"] = str(n).encode()
    db[b"i:" + lower + b":" + mid] = json.dumps(info)
    db[b"n:" + lower + b":" + mid] = notes
    _commit()
    return {"melody": _info_out(mid, info)}


def op_update(req, t):
    lower, mid = _user(req), _melody_id(req)
    k = b"i:" + lower + b":" + mid
    raw = db.get(k)
    if not raw:
        raise Err(404, "Melody not found")
    info, notes = _parse_melody(req, t)
    info["c"] = json.loads(raw)["c"]
    db[k] = json.dumps(info)
    db[b"n:" + lower + b":" + mid] = notes
    _commit()
    return {"melody": _info_out(mid, info)}


def op_delete(req, t):
    lower, mid = _user(req), _melody_id(req)
    k = b"i:" + lower + b":" + mid
    if k not in db:
        raise Err(404, "Melody not found")
    del db[k]
    del db[b"n:" + lower + b":" + mid]
    _commit()
    return {}


OPS = {
    "hello": op_hello, "register": op_register, "login": op_login, "logout": op_logout, "me": op_me,
    "list": op_list, "get": op_get, "create": op_create, "update": op_update, "delete": op_delete,
}


def handle(req):
    """Run one request dict; always returns a response dict with "ok" (and "error"/"code" if not)."""
    try:
        if not isinstance(req, dict) or req.get("op") not in OPS:
            raise Err(400, "Unknown request")
        t = req.get("t")
        if not isinstance(t, (int, float)):
            t = 0
        res = OPS[req["op"]](req, t)
        res["ok"] = True
    except Err as e:
        res = {"ok": False, "code": e.args[0], "error": e.args[1]}
    except Exception as e:  # a bug or a full/corrupt flash: report it instead of crashing the piano
        print("store error:", repr(e))
        res = {"ok": False, "code": 500, "error": "ESP32 error: " + repr(e)}
    res["id"] = req.get("id") if isinstance(req, dict) else None
    return res
