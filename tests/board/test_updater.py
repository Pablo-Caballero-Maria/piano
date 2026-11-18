# The board's update bookkeeping and update steps (esp32/updater.py, esp32/ota.py), without network:
# a temporary "board" folder, a fake download.
import json
import sys

import ota
import updater
import util

OLD = {
    "esp32/a.py": b"A = 1\n",
    "esp32/b.py": b"B = 1\n",
    "tests/board/test_x.py": b"def test_x():\n    pass\n",
}
NEW = {
    "esp32/a.py": b"A = 2\n",
    "esp32/c.py": b"C = 1\n",
    "tests/board/test_x.py": OLD["tests/board/test_x.py"],
}


def blob(data):
    import hashlib
    from binascii import hexlify

    h = hashlib.sha1(("blob %d\0" % len(data)).encode())
    h.update(data)
    return hexlify(h.digest()).decode()


def board():
    folder = util.temp_dir()
    updater.ROOT = folder
    for path in OLD:
        util.write(folder + "/" + updater.board_path(path), OLD[path])
    util.write(folder + "/version.json", json.dumps({"sha": "old", "files": {p: blob(OLD[p]) for p in OLD}}))
    return folder


def stage_new():
    files = {p: [blob(NEW[p]), len(NEW[p])] for p in NEW}
    got = []

    def fetch(path):
        got.append(path)
        util.write(updater._p(updater.NEXT + "/" + updater.board_path(path)), NEW[path])

    ota.stage("http://pc/board/new", files, fetch=fetch)
    return files, got


def text(folder, name):
    return util.read(folder + "/" + name) if util.exists(folder + "/" + name) else None


def test_board_path():
    bp = updater.board_path
    assert bp("esp32/app.py") == "app.py" and bp("esp32/ca.pem") == "ca.pem"
    assert bp("tests/board/testrunner.py") == "tests/testrunner.py"
    for other in (
        "README.md",
        "web/src/app/page.tsx",
        "esp32/sub/x.py",
        "fog/app.py",
        "tests/core/test_x.py",
    ):
        assert bp(other) is None


def test_request_is_taken_once():
    folder = util.temp_dir()
    updater.ROOT = folder
    try:
        assert updater.take_request() is None
        updater.request({"sha": "abc", "url": "https://pc/board/abc"})
        assert updater.take_request() == {"sha": "abc", "url": "https://pc/board/abc"}
        assert updater.take_request() is None
    finally:
        updater.ROOT = ""
        util.rmtree(folder)


def test_update_then_rollback_after_crashes():
    folder = board()
    try:
        files, got = stage_new()
        assert sorted(got) == ["esp32/a.py", "esp32/c.py"]  # test_x.py didn't change: copied
        ota.apply("new", files)
        assert text(folder, "a.py") == b"A = 2\n" and text(folder, "c.py") == b"C = 1\n"
        assert text(folder, "b.py") is None and text(folder, "prev/a.py") == b"A = 1\n"
        assert updater.installed()["sha"] == "new" and updater.version() == "new"
        for _ in range(updater.MAX_BOOTS):
            assert updater.boot_check() is False
        assert updater.boot_check() is True  # it kept crashing
        assert text(folder, "a.py") == b"A = 1\n" and text(folder, "b.py") == b"B = 1\n"
        assert text(folder, "c.py") is None and updater.installed()["sha"] == "old"
        s = updater.state()
        assert s["failed"] == "new" and "trial" not in s and not util.exists(folder + "/prev")
    finally:
        updater.ROOT = ""
        util.rmtree(folder)


def test_a_version_that_connects_is_kept():
    folder = board()
    try:
        files, _ = stage_new()
        ota.apply("new", files)
        updater.mark_good()
        for _ in range(updater.MAX_BOOTS + 2):
            assert updater.boot_check() is False
        assert updater.installed()["sha"] == "new" and not util.exists(folder + "/prev")
    finally:
        updater.ROOT = ""
        util.rmtree(folder)


def test_an_interrupted_install_is_undone():
    folder = board()
    try:
        files, _ = stage_new()
        ota.apply("new", files)
        util.write(folder + "/applying", "new")  # as if the power went off before the end
        assert updater.boot_check() is True
        assert text(folder, "a.py") == b"A = 1\n" and updater.installed()["sha"] == "old"
    finally:
        updater.ROOT = ""
        util.rmtree(folder)


def test_run_tests_uses_the_new_code_and_cleans_up():
    import testrunner

    folder = util.temp_dir()
    try:
        util.write(folder + "/tests/testrunner.py", util.read(testrunner.__file__))
        util.write(folder + "/zzmod.py", "VALUE = 2\n")
        util.write(
            folder + "/tests/test_zz.py", "import zzmod\ndef test_value():\n    assert zzmod.VALUE == 2\n"
        )
        assert ota.run_tests(folder)[0] is True
        assert "zzmod" not in sys.modules and "test_zz" not in sys.modules
        util.write(folder + "/zzmod.py", "VALUE = 333\n")
        try:
            import importlib

            importlib.invalidate_caches()
        except ImportError:
            pass
        ok, summary = ota.run_tests(folder)
        assert ok is False and "test_value" in summary
        assert sys.modules.get("testrunner") is testrunner
    finally:
        util.rmtree(folder)
