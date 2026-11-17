# Pieces of the board's program that don't need the network (esp32/app.py, esp32/config.py).
import json

import app
import config
import util


def test_http_date():
    assert app.parse_http_date("Tue, 17 Nov 2026 18:00:05 GMT") == (2026, 11, 17, 0, 18, 0, 5, 0)


def test_config():
    folder = util.temp_dir()
    try:
        util.write(
            folder + "/config.json", json.dumps({"board": "p1", "wifi": {"ssid": "x"}, "server": "pc"})
        )
        c = config.load(folder + "/config.json")
        assert c["buzzer_pin"] == 33 and c["mqtt"]["port"] == 8883
        assert config.topic(c, "kv/req") == "piano/p1/kv/req"
        util.write(folder + "/config.json", json.dumps({"board": "p1"}))
        util.raises(ValueError, config.load, folder + "/config.json")
    finally:
        util.rmtree(folder)
