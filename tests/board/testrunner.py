# Tiny test runner for the board: MicroPython has no pytest. It runs every test_* function of every
# test_*.py file in a folder. On the laptop, pytest runs the same files instead.
# The board runs it on each new version before installing it (esp32/ota.py); by hand:
#   uv run tools/board.py test

import gc
import os
import sys


def _trace(e):
    if hasattr(sys, "print_exception"):
        sys.print_exception(e)
    else:
        import traceback

        traceback.print_exception(e)


def run(folder, verbose=True):
    """Run the tests in folder. Returns (all passed, one-line summary)."""
    names = sorted(n[:-3] for n in os.listdir(folder) if n.startswith("test_") and n.endswith(".py"))
    passed, failed = 0, []
    for mod_name in names:
        try:
            mod = __import__(mod_name)
        except Exception as e:
            failed.append("%s: can't import it (%r)" % (mod_name, e))
            if verbose:
                print("  FAIL", mod_name, "(import)")
                _trace(e)
            continue
        for name in sorted(dir(mod)):
            fn = getattr(mod, name)
            if not name.startswith("test_") or not callable(fn):
                continue
            try:
                fn()
                passed += 1
                if verbose:
                    print("  ok  ", mod_name + "." + name)
            except Exception as e:
                failed.append("%s.%s (%r)" % (mod_name, name, e))
                if verbose:
                    print("  FAIL", mod_name + "." + name)
                    _trace(e)
            gc.collect()
    summary = "%d passed, %d failed" % (passed, len(failed))
    if failed:
        summary += ": " + "; ".join(failed[:3]) + ("..." if len(failed) > 3 else "")
    if verbose:
        print(summary)
    return not failed and passed > 0, summary


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "/tests")
