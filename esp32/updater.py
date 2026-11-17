# The board's version and update bookkeeping. Kept small, because app.py imports it; the update
# itself (ota.py) only runs in update mode: the teacher's PC sends {"sha", "url"} on
# piano/<board>/ota, app.py saves it with request() and restarts, and main.py runs ota.py alone.
#
# Files of the repository that live on the board (board_path()):
#   esp32/<name>.py, esp32/ca.pem -> /<name>        the firmware
#   tests/board/<path>            -> /tests/<path>  the tests that run on the board before an update
# /version.json: the installed commit and each file's git hash. /update.json: the last result, a
# commit that failed its tests, the trial run of a new version (boots), the last crash.
# The replaced version waits in /prev until the new one has connected to the PC (mark_good());
# boot_check() puts it back if the new one keeps crashing or its install was cut short.
# Runs on MicroPython and CPython (the laptop tests use a temporary ROOT).

import json
import os

ROOT = ""
VERSION_FILE = "version.json"
STATE_FILE = "update.json"
REQUEST_FILE = "ota.json"
NEXT = "next"
PREV = "prev"
APPLYING = "applying"
MAX_BOOTS = 3


def _p(rel):
    return ROOT + "/" + rel


def _exists(path):
    try:
        os.stat(path)
        return True
    except OSError:
        return False


def _isdir(path):
    try:
        return os.stat(path)[0] & 0x4000 != 0
    except OSError:
        return False


def _makedirs(path):
    cur = ""
    for part in path.split("/"):
        if part:
            cur += "/" + part
            if not _isdir(cur):
                os.mkdir(cur)


def _rmtree(path):
    if _isdir(path):
        for name in os.listdir(path):
            _rmtree(path + "/" + name)
        os.rmdir(path)
    elif _exists(path):
        os.remove(path)


def _walk(path, rel=""):
    """Relative names of every file under folder `path`."""
    out = []
    if _isdir(path):
        for name in os.listdir(path):
            if _isdir(path + "/" + name):
                out += _walk(path + "/" + name, rel + name + "/")
            else:
                out.append(rel + name)
    return out


def _move(src, dst):
    _makedirs(dst.rsplit("/", 1)[0])
    _rmtree(dst)
    os.rename(src, dst)


def _load(name, default):
    try:
        with open(_p(name)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _save(name, obj):
    with open(_p(name + ".tmp"), "w") as f:
        json.dump(obj, f)
    _move(_p(name + ".tmp"), _p(name))


def board_path(repo_path):
    """Where a file of the repository goes on the board (relative to its root), or None."""
    if repo_path.startswith("esp32/"):
        name = repo_path[6:]
        return name if "/" not in name and (name.endswith(".py") or name.endswith(".pem")) else None
    if repo_path.startswith("tests/board/"):
        return "tests/" + repo_path[12:]
    return None


def installed():
    """{"sha": installed commit or None, "files": {repo path: git hash}}."""
    v = _load(VERSION_FILE, {})
    return {"sha": v.get("sha"), "files": v.get("files") or {}}


def version():
    return (installed()["sha"] or "unknown")[:7]


def state():
    return _load(STATE_FILE, {})


def set_state(**changes):
    """Change keys of update.json (None removes a key)."""
    s = state()
    for k in changes:
        if changes[k] is None:
            s.pop(k, None)
        else:
            s[k] = changes[k]
    _save(STATE_FILE, s)


def request(req):
    """Save an update request from the PC ({"sha", "url"}); the caller restarts the board."""
    _save(REQUEST_FILE, req)


def take_request():
    """The pending update request (once), or None."""
    req = _load(REQUEST_FILE, None)
    if req is not None:
        os.remove(_p(REQUEST_FILE))
    return req


def boot_check():
    """At power-up: undo an install cut short, or a new version that keeps crashing.
    Returns True if it changed files (the caller then restarts the board)."""
    if _exists(_p(APPLYING)):
        restore("its install was interrupted")
        return True
    s = state()
    if s.get("trial"):
        boots = s.get("boots", 0) + 1
        if boots > MAX_BOOTS:
            restore("it kept restarting")
            return True
        set_state(boots=boots)
    return False


def mark_good():
    """The new version reached the teacher's PC: keep it for good."""
    if state().get("trial"):
        set_state(trial=None, boots=None)
        _rmtree(_p(PREV))


def note_crash(text):
    try:
        set_state(crash=text[-300:])
    except Exception:
        pass


def restore(reason):
    """Put back the version kept in /prev, and remove files only the bad version had."""
    bad = installed()
    for name in _walk(_p(PREV)):
        _move(_p(PREV + "/" + name), _p(name))
    good = installed()
    for path in bad["files"]:
        dest = board_path(path)
        if dest and path not in good["files"]:
            _rmtree(_p(dest))
    for folder in (PREV, NEXT, APPLYING):
        _rmtree(_p(folder))
    failed = bad["sha"] if bad["sha"] != good["sha"] else state().get("trial")
    set_state(
        trial=None,
        boots=None,
        failed=failed,
        ok=False,
        result="Version %s was rolled back: %s" % ((failed or "?")[:7], reason),
    )
    print("Update: rolled back,", reason)
