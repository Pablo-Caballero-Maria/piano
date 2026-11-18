# The board's program (started by main.py). It joins the classroom WiFi, connects to the teacher's
# PC over MQTT with TLS, and then:
#   piano/<board>/tone    -> plays that frequency on the buzzer (2 bytes, little-endian Hz; 0 = off)
#   piano/<board>/chirp   -> a short signal ("online", "ready"…)
#   piano/<board>/kv/req  -> answers the PC's storage request on piano/<board>/kv/res (kv.py)
#   piano/<board>/ota     -> saves the update request and restarts into update mode (ota.py)
# It publishes its state on piano/<board>/status (retained; the broker publishes
# {"online": false} for it if the board disappears) and update results on piano/<board>/log.
# If the WiFi or the PC goes away it retries every few seconds, forever.

import gc
import json
import socket
import struct
import time

import config
import kv
import machine
import mqtt
import network
import tone
import updater

CA_FILE = "/ca.pem"
STATUS_EVERY_MS = 60000
RETRY_S = 5
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


# Why a WiFi join failed, by WLAN status (the ESP32's numbers when the port has no constant)
WIFI_WHY = {
    5: "the network is full (a phone's hotspot takes only a few devices)",  # ASSOC_TOOMANY
    getattr(network, "STAT_NO_AP_FOUND", 201): "not in range (the board only sees 2.4 GHz networks)",
    getattr(network, "STAT_WRONG_PASSWORD", 202): "wrong password",
    getattr(network, "STAT_ASSOC_FAIL", 203): "the router refused the board",
    getattr(network, "STAT_HANDSHAKE_TIMEOUT", 204): "no answer to the password (wrong password?)",
}


def wifi_connect(c, timeout_s=30):
    """Join the classroom WiFi (returns at once if already connected)."""
    sta = network.WLAN(network.STA_IF)
    sta.active(True)
    if sta.isconnected():
        return sta
    ssid = c["wifi"]["ssid"]
    # The WiFi driver keeps retrying a failed join by itself, and refuses connect() meanwhile
    # ("Wifi Internal State Error"): stop it first, so every attempt starts afresh
    sta.disconnect()
    sta.connect(ssid, c["wifi"].get("password") or None)
    start = time.ticks_ms()
    why = None
    while not sta.isconnected():
        status = sta.status()
        why = WIFI_WHY.get(status, why)  # it flips back to "connecting" while retrying
        if time.ticks_diff(time.ticks_ms(), start) > timeout_s * 1000:
            sta.disconnect()
            raise OSError("can't join WiFi %s: %s" % (ssid, why or "status %s" % status))
        time.sleep_ms(200)
    print("WiFi:", ssid, sta.ifconfig()[0])
    return sta


def parse_http_date(value):
    """machine.RTC().datetime() tuple from an HTTP Date header ("Tue, 17 Nov 2026 18:00:05 GMT")."""
    _, day, month, year, hms, _ = value.split()
    h, m, s = (int(x) for x in hms.split(":"))
    return (int(year), MONTHS.index(month) + 1, int(day), 0, h, m, s, 0)


def set_clock(c):
    """TLS certificates are checked against the date: get it from NTP, or else from the teacher's
    PC (the Date header of its web server on port 80), in case the classroom has no internet."""
    try:
        import ntptime

        ntptime.timeout = 2
        ntptime.settime()
        return "ntp"
    except Exception:
        pass
    s = None
    try:
        s = socket.socket()
        s.settimeout(3)
        s.connect(socket.getaddrinfo(c.get("server_ip") or c["server"], 80)[0][-1])
        s.send(b"HEAD / HTTP/1.0\r\nHost: " + c["server"].encode() + b"\r\n\r\n")
        head = s.recv(1024).decode()
        for line in head.split("\r\n"):
            if line.lower().startswith("date:"):
                machine.RTC().datetime(parse_http_date(line[5:].strip()))
                return "http"
    except Exception as e:
        print("Clock:", repr(e))
    finally:
        if s:
            s.close()
    return None


def tls_context(ca_file=CA_FILE):
    import ssl

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.verify_mode = ssl.CERT_REQUIRED
    with open(ca_file) as f:
        ctx.load_verify_locations(cadata=f.read())
    return ctx


def status(store, sta, online=True):
    gc.collect()
    s = {"online": online, "sha": updater.installed()["sha"], "free": store.free(), "heap": gc.mem_free()}
    try:
        s["rssi"] = sta.status("rssi")
    except Exception:
        pass
    return json.dumps(s).encode()


class Board:
    def __init__(self, c, store_path=kv.DB_FILE):
        """c: the settings (config.py). store_path: elsewhere when simulated (tools/fake_board.py)."""
        self.c = c
        self.buzzer = tone.Buzzer(c["buzzer_pin"])
        self.led = machine.Pin(c["led_pin"], machine.Pin.OUT) if c.get("led_pin") is not None else None
        self.store = kv.Store(store_path)

    def set_led(self, on):
        if self.led is not None:
            self.led.value(1 if on else 0)

    def topic(self, name):
        return config.topic(self.c, name)

    def handle(self, client, topic, payload):
        name = topic[len(self.topic("")) :]  # "tone", "kv/req"…
        if name == "tone":
            if len(payload) >= 2:
                self.buzzer.play(struct.unpack("<H", payload[:2])[0])
        elif name == "kv/req":
            client.publish(self.topic("kv/res"), self.store.handle(payload))
        elif name == "chirp":
            self.buzzer.chirp(payload.decode())
        elif name == "ota":
            updater.request(json.loads(payload))
            client.publish(self.topic("log"), b"Restarting to update")
            time.sleep_ms(200)
            machine.reset()

    def session(self):
        """One connection to the teacher's PC; returns (by raising) when it's lost."""
        c = self.c
        sta = wifi_connect(c)
        print("Clock from", set_clock(c))
        client = mqtt.MQTT(
            "board-" + c["board"],
            c["server"],
            c["mqtt"]["port"],
            c["mqtt"].get("user"),
            c["mqtt"].get("password"),
            keepalive=30,
            tls=tls_context(c.get("ca", CA_FILE)) if c["mqtt"].get("tls", True) else None,
            address=c.get("server_ip"),
        )
        client.connect(will=(self.topic("status"), b'{"online": false}', True))
        try:
            for name in ("tone", "chirp", "kv/req", "ota"):
                client.subscribe(self.topic(name))
            client.publish(self.topic("status"), status(self.store, sta), retain=True)
            last = updater.state().get("result")
            if last:
                client.publish(self.topic("log"), last.encode())
            updater.mark_good()  # a new version that reaches the PC is kept (no rollback)
            self.buzzer.chirp("online")
            self.set_led(True)
            print("Connected to", c["server"])
            sent = time.ticks_ms()
            while True:
                msg = client.check(20)
                if msg:
                    self.handle(client, msg[0], msg[1])
                client.keepalive()
                if time.ticks_diff(time.ticks_ms(), sent) > STATUS_EVERY_MS:
                    client.publish(self.topic("status"), status(self.store, sta), retain=True)
                    sent = time.ticks_ms()
        finally:
            self.buzzer.play(0)
            self.set_led(False)
            client.close()

    def run(self):
        """Keep a connection to the teacher's PC, forever."""
        self.buzzer.chirp("ready")
        try:
            while True:
                try:
                    self.session()
                except OSError as e:
                    print("Link lost:", repr(e))
                    self.buzzer.chirp("offline")
                    time.sleep(RETRY_S)
        finally:
            self.buzzer.off()
            self.store.close()


def run():
    Board(config.load()).run()


if __name__ == "__main__":
    run()
