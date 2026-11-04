# /// script
# requires-python = ">=3.10"
# dependencies = ["dbus-fast"]
# ///
# Pretend to be the ESP32 piano, to test the website without the board.
# The laptop advertises as "ESP32-Piano" with the same BLE service/characteristic
# as esp32/main.py, prints every note it receives and plays it on the laptop speaker.
#
# Run:  uv run tools/fake_esp32.py          (Ctrl-C to stop; --silent = no sound)
# Then open the website on ANOTHER device (e.g. your phone) and press Connect:
# a browser can't connect to the Bluetooth adapter of its own computer.
# Needs BlueZ running (systemctl status bluetooth).

import array
import asyncio
import math
import subprocess
import sys
import threading
import time

from dbus_fast import BusType, Message, Variant
from dbus_fast.aio import MessageBus
from dbus_fast.service import PropertyAccess, ServiceInterface, dbus_property, method

# Must match esp32/main.py and web/public/js/ble.js
DEVICE_NAME = "ESP32-Piano"
SERVICE_UUID = "7a3e0001-5c2b-4f8e-9d61-3b2f1c9a8e10"
NOTE_UUID = "7a3e0002-5c2b-4f8e-9d61-3b2f1c9a8e10"

BLUEZ = "org.bluez"
APP_PATH = "/piano"
SERVICE_PATH = APP_PATH + "/service0"
CHAR_PATH = SERVICE_PATH + "/char0"
ADV_PATH = APP_PATH + "/advertisement0"
FLAGS = ["write", "write-without-response"]

NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def note_name(freq):
    """Nearest note name for a frequency, e.g. 440 -> "A4" (0 -> "silence")."""
    if freq <= 0:
        return "silence"
    m = round(69 + 12 * math.log2(freq / 440))
    return f"{NAMES[m % 12]}{m // 12 - 1}"


class Tone:
    """Square wave on the laptop speaker, like the buzzer (needs pacat from PulseAudio/PipeWire)."""

    RATE = 22050

    def __init__(self):
        self.freq = 0
        try:
            self.proc = subprocess.Popen(
                ["pacat", "--raw", "--format=s16le", f"--rate={self.RATE}", "--channels=1", "--latency-msec=40"],
                stdin=subprocess.PIPE,
            )
        except FileNotFoundError:
            print("pacat not found: no sound, only printing notes")
            return
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        """Background thread: stream 20 ms chunks of the current square wave to pacat, forever."""
        phase = 0.0
        while True:
            f = self.freq
            buf = array.array("h", bytes(2 * self.RATE // 50))  # 20 ms of silence
            if f:
                for i in range(len(buf)):
                    phase = (phase + f / self.RATE) % 1.0
                    buf[i] = 2500 if phase < 0.5 else -2500
            self.proc.stdin.write(buf.tobytes())
            self.proc.stdin.flush()


class Application(ServiceInterface):
    """BlueZ reads the whole GATT database from this ObjectManager."""

    def __init__(self):
        super().__init__("org.freedesktop.DBus.ObjectManager")

    @method()
    def GetManagedObjects(self) -> "a{oa{sa{sv}}}":
        return {
            SERVICE_PATH: {"org.bluez.GattService1": {
                "UUID": Variant("s", SERVICE_UUID),
                "Primary": Variant("b", True),
                "Characteristics": Variant("ao", [CHAR_PATH]),
            }},
            CHAR_PATH: {"org.bluez.GattCharacteristic1": {
                "UUID": Variant("s", NOTE_UUID),
                "Service": Variant("o", SERVICE_PATH),
                "Flags": Variant("as", FLAGS),
            }},
        }


class GattService(ServiceInterface):
    """The piano's primary GATT service (same UUID as the ESP32's)."""

    def __init__(self):
        super().__init__("org.bluez.GattService1")

    @dbus_property(access=PropertyAccess.READ)
    def UUID(self) -> "s":
        return SERVICE_UUID

    @dbus_property(access=PropertyAccess.READ)
    def Primary(self) -> "b":
        return True


class NoteCharacteristic(ServiceInterface):
    """The writable note characteristic; each write calls `on_freq(frequency_hz)`."""

    def __init__(self, on_freq):
        super().__init__("org.bluez.GattCharacteristic1")
        self.on_freq = on_freq

    @dbus_property(access=PropertyAccess.READ)
    def UUID(self) -> "s":
        return NOTE_UUID

    @dbus_property(access=PropertyAccess.READ)
    def Service(self) -> "o":
        return SERVICE_PATH

    @dbus_property(access=PropertyAccess.READ)
    def Flags(self) -> "as":
        return FLAGS

    @method()
    def WriteValue(self, value: "ay", options: "a{sv}"):
        """Called by BlueZ for every write from the browser."""
        if len(value) >= 2:
            # 2 bytes, little-endian: frequency in Hz (0 = silence)
            self.on_freq(value[0] | value[1] << 8)


class Advertisement(ServiceInterface):
    """LE advertisement BlueZ broadcasts on our behalf."""

    # Name only, like the ESP32's advertising packet; the website finds the device by name
    def __init__(self):
        super().__init__("org.bluez.LEAdvertisement1")

    @dbus_property(access=PropertyAccess.READ)
    def Type(self) -> "s":
        return "peripheral"

    @dbus_property(access=PropertyAccess.READ)
    def LocalName(self) -> "s":
        return DEVICE_NAME

    @method()
    def Release(self):
        pass


async def main():
    """Export the GATT app + advertisement on the system D-Bus, register them with BlueZ and run forever."""
    tone = None if "--silent" in sys.argv else Tone()
    last = [time.monotonic()]

    def on_freq(freq):
        """Log the received note with the time since the previous one, and play it."""
        now = time.monotonic()
        print(f"+{(now - last[0]) * 1000:6.0f} ms  {freq:5d} Hz  {note_name(freq)}", flush=True)
        last[0] = now
        if tone:
            tone.freq = freq

    bus = await MessageBus(bus_type=BusType.SYSTEM).connect()
    bus.export(APP_PATH, Application())
    bus.export(SERVICE_PATH, GattService())
    bus.export(CHAR_PATH, NoteCharacteristic(on_freq))
    bus.export(ADV_PATH, Advertisement())

    root = bus.get_proxy_object(BLUEZ, "/", await bus.introspect(BLUEZ, "/"))
    objects = await root.get_interface("org.freedesktop.DBus.ObjectManager").call_get_managed_objects()
    adapter = next(p for p, ifaces in objects.items()
                   if "org.bluez.GattManager1" in ifaces and "org.bluez.LEAdvertisingManager1" in ifaces)
    adapter_obj = bus.get_proxy_object(BLUEZ, adapter, await bus.introspect(BLUEZ, adapter))
    await adapter_obj.get_interface("org.freedesktop.DBus.Properties").call_set(
        "org.bluez.Adapter1", "Powered", Variant("b", True))

    # Report phones connecting/disconnecting. A phone BlueZ hasn't seen before shows up
    # already connected (InterfacesAdded); later changes come as PropertiesChanged.
    def report(path, props):
        """Print a connect/disconnect line if `props` (Device1 properties) carries Connected."""
        if "Connected" not in props:
            return
        connected = props["Connected"].value
        name = props["Name"].value if "Name" in props else path
        print(("Connected: " if connected else "Disconnected: ") + name, flush=True)
        if not connected and tone:
            tone.freq = 0  # like the ESP32: never leave a note stuck on

    def on_message(msg):
        """D-Bus signal handler: forward BlueZ device changes to report()."""
        if msg.member == "PropertiesChanged" and msg.body and msg.body[0] == "org.bluez.Device1":
            report(msg.path, msg.body[1])
        elif msg.member == "InterfacesAdded" and "org.bluez.Device1" in msg.body[1]:
            report(msg.body[0], msg.body[1]["org.bluez.Device1"])

    for rule in ("type='signal',sender='org.bluez',interface='org.freedesktop.DBus.Properties',"
                 "member='PropertiesChanged',arg0='org.bluez.Device1'",
                 "type='signal',sender='org.bluez',interface='org.freedesktop.DBus.ObjectManager',"
                 "member='InterfacesAdded'"):
        await bus.call(Message(
            destination="org.freedesktop.DBus", path="/org/freedesktop/DBus", interface="org.freedesktop.DBus",
            member="AddMatch", signature="s", body=[rule]))
    bus.add_message_handler(on_message)

    await adapter_obj.get_interface("org.bluez.GattManager1").call_register_application(APP_PATH, {})
    print("GATT service registered", flush=True)
    await adapter_obj.get_interface("org.bluez.LEAdvertisingManager1").call_register_advertisement(ADV_PATH, {})
    print(f"Advertising as {DEVICE_NAME}: open the website on your phone and press Connect", flush=True)

    await bus.wait_for_disconnect()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
