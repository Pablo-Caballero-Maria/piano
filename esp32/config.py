# The board's settings, in /config.json (written over USB by `uv run tools/board.py setup`, which
# takes them from the teacher PC's .env). Example:
#
#   {"board": "piano1",
#    "wifi": {"ssid": "AulaPiano", "password": "…"},
#    "server": "piano-esp32.duckdns.org",       the teacher's PC (MQTT broker, update server)
#    "server_ip": "192.168.1.10",                optional: skip DNS (the certificate is still checked)
#    "mqtt": {"port": 8883, "user": "board-piano1", "password": "…"},
#    "buzzer_pin": 33, "led_pin": 2}
#
# The file holds passwords: it never leaves the board (tools/board.py writes it, nobody reads it).

import json

PATH = "/config.json"
DEFAULTS = {"buzzer_pin": 33, "led_pin": 2, "mqtt": {"port": 8883}}


def load(path=PATH):
    with open(path) as f:
        c = json.load(f)
    for k in DEFAULTS:
        c.setdefault(k, DEFAULTS[k])
    for k in ("board", "wifi", "server"):
        if not c.get(k):
            raise ValueError("config.json has no " + k)
    return c


def topic(c, name):
    """The MQTT topic piano/<board>/<name>."""
    return "piano/%s/%s" % (c["board"], name)
