"""Run the board's MicroPython code on CPython: the time.ticks_* / sleep_ms functions,
sys.print_exception and gc.mem_free it uses. ``install()`` once, before importing board modules (the tests'
conftest and tools/fake_board.py do). The modules next to this one stand in for the
board-only ones (machine, network, btree)."""

import gc
import sys
import time
import traceback


def install() -> None:
    if not hasattr(time, "ticks_ms"):
        time.ticks_ms = lambda: int(time.monotonic() * 1000)
        time.ticks_diff = lambda a, b: a - b
        time.ticks_add = lambda a, b: a + b
        time.sleep_ms = lambda ms: time.sleep(ms / 1000)
    if not hasattr(gc, "mem_free"):
        gc.mem_free = lambda: 0  # no fixed heap here
    if not hasattr(sys, "print_exception"):
        sys.print_exception = lambda e, file=None: traceback.print_exception(e, file=file)
