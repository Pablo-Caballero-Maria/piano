# Pieces of the board's program that don't need the network (esp32/app.py, esp32/config.py).
import json

import app
import config
import util


def test_http_date():
    assert app.parse_http_date("Tue, 17 Nov 2026 18:00:05 GMT") == (2026, 11, 17, 0, 18, 0, 5, 0)


class FailingWLAN:
    """A WiFi that never joins: the driver says why the first try failed, then "connecting" again."""

    def __init__(self, interface):
        self.polls = 0
        self.calls = []

    def active(self, on=None):
        return True

    def isconnected(self):
        return False

    def connect(self, ssid, password=None):
        self.calls.append("connect")

    def disconnect(self):
        self.calls.append("disconnect")

    def status(self, param=None):
        self.polls += 1
        return 202 if self.polls == 1 else 1001


class FakeNetwork:
    STA_IF = 0

    def __init__(self):
        self.sta = None

    def WLAN(self, interface):
        self.sta = self.sta or FailingWLAN(interface)
        return self.sta


def test_wifi_join_failure_says_why_and_stops_the_driver():
    real, fake = app.network, FakeNetwork()
    app.network = fake  # only the fake WiFi: the board's own isn't touched
    try:
        c = {"wifi": {"ssid": "Aula 3", "password": "x"}}
        e = util.raises(OSError, app.wifi_connect, c, 0.5)  # gives up while it says "connecting"
        assert "Aula 3: wrong password" in str(e), str(e)
        assert fake.sta.polls > 1
        # stopped before joining (a retry would be refused) and after giving up
        assert fake.sta.calls == ["disconnect", "connect", "disconnect"], fake.sta.calls
    finally:
        app.network = real


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
