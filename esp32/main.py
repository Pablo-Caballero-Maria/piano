# Start-up of the board (MicroPython runs main.py at power-up). It keeps the board going alone:
# - updater.boot_check() first: an update whose install was cut short, or a new version that keeps
#   crashing, is rolled back to the previous version.
# - Update mode: if the teacher's PC asked for an update (piano/<board>/ota), only ota.py runs,
#   then the board restarts into the new version.
# - Otherwise app.py runs: the buzzer and storage for the teacher's PC. If it crashes, the error is
#   saved (the PC shows it) and the board restarts 5 s later. Ctrl-C from mpremote just stops it.
# Keep this file small and simple: updates replace it too, and it's what lets a bad one be undone.

import sys
import time

import machine


def note(e):
    sys.print_exception(e)
    try:
        import io

        import updater

        text = io.StringIO()
        sys.print_exception(e, text)
        updater.note_crash(text.getvalue())
    except Exception:
        pass


try:
    import updater

    if updater.boot_check():
        machine.reset()  # files were rolled back: start again with them
    req = updater.take_request()
except Exception as e:
    print("boot_check failed:", repr(e))
    req = None

if req:
    try:
        import ota

        ota.run(req)
    except Exception as e:
        note(e)
    machine.reset()  # into the new version (or the old one, if the update failed)

try:
    import app

    app.run()
except Exception as e:
    note(e)
    time.sleep(5)
    machine.reset()
