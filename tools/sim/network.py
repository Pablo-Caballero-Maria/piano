"""Stand-in for MicroPython's ``network`` module (simulated board): the laptop is always online."""

STA_IF, AP_IF = 0, 1
STAT_IDLE, STAT_CONNECTING, STAT_GOT_IP = 1000, 1001, 1010


class WLAN:
    def __init__(self, interface):
        self._active = False

    def active(self, on=None):
        if on is not None:
            self._active = on
        return self._active

    def connect(self, ssid, password=None):
        pass

    def isconnected(self):
        return True

    def status(self, param=None):
        return -50 if param == "rssi" else STAT_GOT_IP

    def ifconfig(self):
        return ("127.0.0.1", "255.0.0.0", "127.0.0.1", "127.0.0.1")
