"""Stand-in for MicroPython's ``btree`` (simulated board, tests): a sorted key/value store saved
(with pickle) into the file object it's given. The calls esp32/kv.py uses."""

import pickle

INCL = 1


def open(f, **kwargs):
    return _DB(f)


class _DB:
    def __init__(self, f):
        self.f = f
        f.seek(0)
        data = f.read()
        self.d = pickle.loads(data) if data else {}

    def __getitem__(self, k):
        return self.d[bytes(k)]

    def __setitem__(self, k, v):
        self.d[bytes(k)] = bytes(v)

    def __delitem__(self, k):
        del self.d[bytes(k)]

    def __contains__(self, k):
        return bytes(k) in self.d

    def __iter__(self):
        return iter(sorted(self.d))

    def get(self, k, default=None):
        return self.d.get(bytes(k), default)

    def keys(self, start=None, end=None, flags=0):
        for k in sorted(self.d):
            if start is not None and k < bytes(start):
                continue
            if end is not None and (k > bytes(end) or (k == bytes(end) and not flags & INCL)):
                break
            yield k

    def flush(self):
        self.f.seek(0)
        self.f.truncate()
        self.f.write(pickle.dumps(self.d))
        self.f.flush()

    def close(self):
        self.flush()
