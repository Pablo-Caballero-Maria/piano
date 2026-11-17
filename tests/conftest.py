"""Fixtures shared by the laptop tests (pytest). The board's own tests are in tests/board."""

import os

import upy  # tools/sim: lets the board's MicroPython code run here

upy.install()

import pytest  # noqa: E402  (after upy.install())

from pianocore.crypto import Keys  # noqa: E402  (after upy.install())
from pianocore.kv_repo import KVRepo, MemoryKV  # noqa: E402  (after upy.install())
from pianocore.repo import MemoryRepo  # noqa: E402  (after upy.install())


@pytest.fixture
def keys() -> Keys:
    return Keys(os.urandom(32))


@pytest.fixture(params=["memory", "kv"])
def repo(request, keys):
    """Each repository implementation that runs without a network (Atlas: tests/core/test_mongo.py)."""
    return MemoryRepo() if request.param == "memory" else KVRepo(MemoryKV(), keys)
