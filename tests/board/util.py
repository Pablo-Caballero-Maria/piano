# Helpers for the tests that run on the board too (MicroPython has no pytest or tempfile).
import os

_count = 0


def temp_dir():
    """A new empty folder (remove it with rmtree)."""
    global _count
    try:
        import tempfile

        return tempfile.mkdtemp(prefix="piano-test-")
    except ImportError:  # MicroPython
        _count += 1
        path = "/_test%d" % _count
        rmtree(path)
        os.mkdir(path)
        return path


def exists(path):
    try:
        os.stat(path)
        return True
    except OSError:
        return False


def rmtree(path):
    try:
        mode = os.stat(path)[0]
    except OSError:
        return
    if mode & 0x4000:
        for name in os.listdir(path):
            rmtree(path + "/" + name)
        os.rmdir(path)
    else:
        os.remove(path)


def write(path, data):
    """Write bytes or str to path, creating its folders."""
    cur = ""
    for part in path.split("/")[:-1]:
        if part:
            cur += "/" + part
            if not exists(cur):
                os.mkdir(cur)
    with open(path, "wb") as f:
        f.write(data.encode() if isinstance(data, str) else data)


def read(path):
    with open(path, "rb") as f:
        return f.read()


def raises(exc, fn, *args):
    """Call fn(*args) and check that it raises exc; returns the exception."""
    try:
        fn(*args)
    except exc as e:
        return e
    raise AssertionError("%s not raised" % exc.__name__)
