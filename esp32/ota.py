# Update mode: the teacher's PC asked for an update (updater.request()), and main.py runs this
# alone after a restart, with nothing else in memory. run():
# 1. joins the WiFi and sets the clock (TLS checks certificate dates);
# 2. fetches <url>/manifest.json from the PC: {"sha", "files": {repo path: [git hash, size]}};
# 3. downloads the files that changed into /next, checking each one's git hash, and copies the
#    unchanged ones from the current version;
# 4. runs the board's test suite (/next/tests) on that code: if a test fails, nothing changes;
# 5. installs it (the current version goes to /prev); main.py then restarts the board into it.
# HTTPS with certificate checks (ca.pem). The PC serves these files from its git checkout of the
# commit that passed its own tests (fog/updater.py). Runs on CPython too (tests use plain http).

import gc
import hashlib
import json
import os
import socket
from binascii import hexlify

import updater as u

CA_FILE = "ca.pem"
TIMEOUT_S = 20


# ---- HTTP(S) GET -----------------------------------------------------------------------------------
def _send(s, data):
    if hasattr(s, "sendall"):
        s.sendall(data)
    else:
        s.write(data)


def get(url, sink=None, address=None, limit=64 * 1024):
    """GET url (http or https, certificate checked). The body goes to sink.write() if given,
    else it's returned (up to `limit` bytes). address: connect there instead of resolving."""
    scheme, rest = url.split("://", 1)
    hostport, _, path = rest.partition("/")
    host, _, port = hostport.partition(":")
    port = int(port) if port else (443 if scheme == "https" else 80)
    s = socket.socket()
    s.settimeout(TIMEOUT_S)
    try:
        s.connect(socket.getaddrinfo(address or host, port)[0][-1])
        if scheme == "https":
            import ssl

            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            ctx.verify_mode = ssl.CERT_REQUIRED
            with open(u._p(CA_FILE)) as f:
                ctx.load_verify_locations(cadata=f.read())
            s = ctx.wrap_socket(s, server_hostname=host)
        _send(
            s,
            (
                "GET /%s HTTP/1.1\r\nHost: %s\r\nUser-Agent: esp32-piano\r\nConnection: close\r\n\r\n"
                % (path, host)
            ).encode(),
        )
        f = s.makefile("rb") if hasattr(s, "makefile") else s  # MicroPython's TLS socket reads lines itself
        status = int(f.readline().split()[1])
        length, chunked = None, False
        while True:
            line = f.readline()
            if line in (b"\r\n", b"\n", b""):
                break
            k, _, v = line.decode().partition(":")
            k = k.strip().lower()
            if k == "content-length":
                length = int(v)
            elif k == "transfer-encoding" and "chunked" in v:
                chunked = True
        if status != 200:
            raise OSError("%s answered %d" % (url, status))
        out = []
        size = 0

        def take(data):
            nonlocal size
            size += len(data)
            if sink is not None:
                sink.write(data)
            elif size > limit:
                raise ValueError("answer too big")
            else:
                out.append(data)

        if chunked:
            while True:
                n = int(f.readline().split(b";")[0].strip().decode() or "0", 16)
                if not n:
                    break
                while n:
                    data = f.read(min(n, 1024))
                    if not data:
                        raise OSError("connection closed mid-answer")
                    take(data)
                    n -= len(data)
                f.read(2)
        else:
            while length is None or size < length:
                data = f.read(1024 if length is None else min(1024, length - size))
                if not data:
                    if length is not None:
                        raise OSError("connection closed mid-answer")
                    break
                take(data)
        return b"".join(out)
    finally:
        s.close()


# ---- Steps ----------------------------------------------------------------------------------------
class _Hasher:
    """Writes to a file while computing the git hash of what's written."""

    def __init__(self, f, size):
        self.f, self.n = f, 0
        self.h = hashlib.sha1(("blob %d\0" % size).encode())

    def write(self, data):
        self.f.write(data)
        self.h.update(data)
        self.n += len(data)

    def hex(self):
        return hexlify(self.h.digest()).decode()


def download(base, repo_path, blob, size, address=None):
    """Download one file into /next (at its board path), checking its git hash."""
    path = u._p(u.NEXT + "/" + u.board_path(repo_path))
    u._makedirs(path.rsplit("/", 1)[0])
    with open(path, "wb") as f:
        sink = _Hasher(f, size)
        get(base + "/" + repo_path, sink=sink, address=address)
    if sink.n != size or sink.hex() != blob:
        os.remove(path)
        raise ValueError("%s arrived damaged (wrong git hash)" % repo_path)


def _copy(src, dst):
    u._makedirs(dst.rsplit("/", 1)[0])
    with open(src, "rb") as f, open(dst, "wb") as g:
        while True:
            b = f.read(1024)
            if not b:
                break
            g.write(b)


def stage(base, files, address=None, fetch=None):
    """Assemble the new version in /next. fetch(repo path) can replace download() (tests)."""
    cur = u.installed()["files"]
    u._rmtree(u._p(u.NEXT))
    u._makedirs(u._p(u.NEXT))
    changed = []
    for path in sorted(files):
        dest = u.board_path(path)
        if cur.get(path) == files[path][0] and u._exists(u._p(dest)):
            _copy(u._p(dest), u._p(u.NEXT + "/" + dest))
            continue
        changed.append(path)
        print("Update: downloading", path)
        if fetch is not None:
            fetch(path)
        else:
            download(base, path, files[path][0], files[path][1], address)
        gc.collect()
    return changed


def run_tests(folder):
    """Run folder/tests against the code in folder (imported from there). Returns (passed, summary)."""
    import sys

    tests = folder + "/tests"
    if not u._isdir(tests):
        return False, "the new version has no tests"
    saved_path = list(sys.path)
    saved_modules = dict(sys.modules)
    for f in (folder, tests):
        for n in os.listdir(f):
            if n.endswith(".py"):
                sys.modules.pop(n[:-3], None)
    sys.path.insert(0, tests)
    sys.path.insert(0, folder)
    try:
        import testrunner

        return testrunner.run(tests)
    except Exception as e:
        return False, "the tests crashed: %r" % (e,)
    finally:
        sys.path.clear()
        sys.path.extend(saved_path)
        for name in list(sys.modules):
            if name not in saved_modules:
                del sys.modules[name]
        for name in saved_modules:
            sys.modules[name] = saved_modules[name]
        gc.collect()


def apply(sha, files):
    """Install the version assembled in /next, moving the current one to /prev."""
    cur = u.installed()
    u._rmtree(u._p(u.PREV))
    u._makedirs(u._p(u.PREV))
    with open(u._p(u.APPLYING), "w") as f:
        f.write(sha)
    staged = u._walk(u._p(u.NEXT))
    for dest in [u.board_path(p) for p in cur["files"]] + staged:
        if dest and u._exists(u._p(dest)) and not u._exists(u._p(u.PREV + "/" + dest)):
            u._move(u._p(dest), u._p(u.PREV + "/" + dest))
    if u._exists(u._p(u.VERSION_FILE)):
        u._move(u._p(u.VERSION_FILE), u._p(u.PREV + "/" + u.VERSION_FILE))
    for name in staged:
        u._move(u._p(u.NEXT + "/" + name), u._p(name))
    u._save(u.VERSION_FILE, {"sha": sha, "files": {p: files[p][0] for p in files}})
    u._rmtree(u._p(u.NEXT))
    u.set_state(trial=sha, boots=0)
    os.remove(u._p(u.APPLYING))


def _done(ok, message):
    u.set_state(result=message, ok=ok)
    print("Update:", message)
    return ok, message


def update(base, sha, address=None, fetch=None):
    """Install commit sha from base (the PC's /board/<sha>). Returns (ok, message)."""
    manifest = json.loads(get(base + "/manifest.json", address=address))
    if manifest.get("sha") != sha:
        raise ValueError("the PC offered another version")
    files = {p: v for p, v in manifest["files"].items() if u.board_path(p)}
    cur = u.installed()
    if cur["sha"] == sha:
        return _done(True, "Already on version %s" % sha[:7])
    if sha == u.state().get("failed"):
        return _done(False, "Version %s failed its tests before" % sha[:7])
    changed = stage(base, files, address, fetch)
    passed, summary = run_tests(u._p(u.NEXT))
    if not passed:
        u._rmtree(u._p(u.NEXT))
        u.set_state(failed=sha)
        return _done(
            False,
            "Version %s failed its tests (%s); keeping %s" % (sha[:7], summary, (cur["sha"] or "?")[:7]),
        )
    apply(sha, files)
    return _done(
        True, "Updated to version %s (%d files changed, tests: %s)" % (sha[:7], len(changed), summary)
    )


def run(req):
    """Update mode (main.py). The caller restarts the board afterwards."""
    import app
    import config

    try:
        c = config.load()
        app.wifi_connect(c)
        app.set_clock(c)
        return update(req["url"], req["sha"], address=c.get("server_ip"))
    except Exception as e:
        return _done(False, "Update failed: %r" % (e,))
