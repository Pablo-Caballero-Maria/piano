# Bluetooth (BLE) piano receiver for an ESP32 + buzzer (MicroPython).
# The web app (web/public/js/ble.js) writes the frequency to play; the buzzer holds it
# until the next write. A frequency of 0 means silence.
# A second characteristic carries the Studio's storage requests (accounts and
# melodies, kept on this board's flash by store.py), see README.md "Storage protocol".
#
# store.py must be on the board:  mpremote connect /dev/ttyUSB0 cp esp32/store.py :store.py
# Test without installing:        mpremote connect /dev/ttyUSB0 run esp32/main.py
# Install to start on power-up:   mpremote connect /dev/ttyUSB0 cp esp32/store.py :store.py + cp esp32/main.py :main.py + reset

import bluetooth
import json
import struct
import time
from machine import Pin, PWM
from micropython import const

import store

BUZZER_PIN = 33   # GPIO (board label D33) the buzzer module's S pin is wired to
LED_PIN = 2       # On-board LED, lit while a phone/PC is connected (None to disable)
VOLUME = 0.5      # PWM duty cycle 0.0-0.5 (0.5 is the loudest for a passive buzzer)
DEVICE_NAME = "ESP32-Piano"

# Must match SERVICE_UUID / NOTE_UUID / DATA_UUID in web/public/js/ble.js
SERVICE_UUID = bluetooth.UUID("7a3e0001-5c2b-4f8e-9d61-3b2f1c9a8e10")
NOTE_UUID = bluetooth.UUID("7a3e0002-5c2b-4f8e-9d61-3b2f1c9a8e10")
DATA_UUID = bluetooth.UUID("7a3e0003-5c2b-4f8e-9d61-3b2f1c9a8e10")
MAX_MSG = 24000   # largest storage request accepted, bytes

_IRQ_CENTRAL_CONNECT = const(1)
_IRQ_CENTRAL_DISCONNECT = const(2)
_IRQ_GATTS_WRITE = const(3)
_IRQ_MTU_EXCHANGED = const(21)
_FLAG_WRITE_NO_RESPONSE = const(0x0004)
_FLAG_WRITE = const(0x0008)
_FLAG_NOTIFY = const(0x0010)

# Advertising packet: flags + device name. The 128-bit service UUID doesn't fit
# alongside the name in 31 bytes, so it goes in the scan response.
_name = DEVICE_NAME.encode()
ADV_DATA = bytes((2, 0x01, 0x06)) + bytes((len(_name) + 1, 0x09)) + _name
RESP_DATA = bytes((17, 0x07)) + bytes(SERVICE_UUID)

pwm = PWM(Pin(BUZZER_PIN), freq=440)
led = Pin(LED_PIN, Pin.OUT) if LED_PIN is not None else None
current_freq = 0
chirp = None  # chirp queued by the BLE handler, played from the main loop

# Storage link state. Each message (both ways) is a 4-byte little-endian length + JSON.
conn = None        # handle of the connected phone/PC
mtu = 23           # negotiated ATT MTU (notifications carry mtu - 3 bytes)
rx = bytearray()   # request bytes received so far (only touched in the BLE handler)
skip = 0           # bytes still to discard from an oversized request
requests = []      # complete requests (bytes, or None = too big) for the main loop


def set_duty(fraction):
    """Set the PWM duty cycle as a fraction (0.0-1.0); 0 silences the buzzer."""
    # Newer firmware has duty_u16 (0-65535); older ESP32 builds only have duty (0-1023)
    if hasattr(pwm, "duty_u16"):
        pwm.duty_u16(int(fraction * 65535))
    else:
        pwm.duty(int(fraction * 1023))


def play(freq):
    """Hold `freq` Hz (clamped to 20-20000) until the next call; 0 = silence."""
    global current_freq
    if freq == current_freq:
        return
    current_freq = freq
    if freq <= 0:
        set_duty(0)
    else:
        pwm.freq(min(max(freq, 20), 20000))
        set_duty(VOLUME)


def play_chirp(freqs):
    """Play each frequency for 70 ms, then go silent. Blocks, so call it from the main loop."""
    for f in freqs:
        play(f)
        time.sleep_ms(70)
    play(0)


CHIRPS = {
    "ready": (1047, 1319, 1568),   # C6 E6 G6
    "connect": (1568, 2093),       # G6 C7
    "disconnect": (2093, 1568),    # C7 G6
}


def set_led(on):
    """Turn the status LED on/off (does nothing if LED_PIN is None)."""
    if led is not None:
        led.value(1 if on else 0)


def advertise():
    """Start advertising as DEVICE_NAME every 100 ms so the browser can find the board."""
    ble.gap_advertise(100000, adv_data=ADV_DATA, resp_data=RESP_DATA)


def receive(chunk):
    """Add storage bytes from the browser; queue every complete request for the main loop."""
    global rx, skip
    if skip:
        n = min(skip, len(chunk))
        skip -= n
        chunk = chunk[n:]
    rx.extend(chunk)
    while len(rx) >= 4:
        size = struct.unpack_from("<I", rx)[0]
        if size > MAX_MSG:
            skip = max(0, 4 + size - len(rx))
            rx = bytearray()
            requests.append(None)
            return
        if len(rx) < 4 + size:
            return
        requests.append(bytes(rx[4:4 + size]))
        rx = rx[4 + size:]


def on_ble(event, data):
    """BLE IRQ handler: connect/disconnect bookkeeping, note writes (played immediately)
    and storage bytes (answered from the main loop)."""
    global chirp, conn, mtu, rx, skip
    if event == _IRQ_CENTRAL_CONNECT:
        conn, mtu, rx, skip = data[0], 23, bytearray(), 0
        set_led(True)
        chirp = "connect"
        print("Connected")
    elif event == _IRQ_CENTRAL_DISCONNECT:
        # Never leave a note stuck on if the phone walks away mid-note
        play(0)
        conn, rx, skip = None, bytearray(), 0
        requests.clear()
        set_led(False)
        chirp = "disconnect"
        print("Disconnected, advertising again")
        advertise()
    elif event == _IRQ_MTU_EXCHANGED:
        mtu = data[1]
    elif event == _IRQ_GATTS_WRITE:
        _, handle = data
        if handle == note_handle:
            msg = ble.gatts_read(note_handle)
            if len(msg) >= 2:
                # 2 bytes, little-endian: frequency in Hz (0 = silence)
                play(struct.unpack_from("<H", msg)[0])
        elif handle == data_handle:
            receive(ble.gatts_read(data_handle))


def reply(res):
    """Send a response dict to the browser as notifications of up to mtu - 3 bytes."""
    body = json.dumps(res).encode()
    msg = struct.pack("<I", len(body)) + body
    view = memoryview(msg)
    step = max(20, mtu - 3)
    i, tries = 0, 0
    while i < len(msg) and conn is not None:
        try:
            ble.gatts_notify(conn, data_handle, view[i:i + step])
            i += step
            tries = 0
        except OSError:
            # The BLE stack's buffers are full: give it time to send (notes keep playing meanwhile)
            tries += 1
            if tries > 200:
                print("reply: gave up")
                return
            time.sleep_ms(10)


def serve(raw):
    """Answer one storage request (bytes of JSON, or None if it was too big)."""
    if raw is None:
        reply({"ok": False, "code": 413, "error": "Too big for the ESP32", "id": None})
        return
    try:
        req = json.loads(raw)
    except ValueError:
        reply({"ok": False, "code": 400, "error": "Bad request", "id": None})
        return
    res = store.handle(req)
    if req.get("op") == "hello" and res.get("ok"):
        res["mtu"] = mtu
    print("Storage:", req.get("op"), "->", "ok" if res.get("ok") else res.get("error"))
    reply(res)


set_duty(0)
ble = bluetooth.BLE()
ble.active(True)
try:
    ble.config(gap_name=DEVICE_NAME)
except Exception:
    pass  # older firmware; the advertised name is what the browser sees anyway
try:
    ble.config(mtu=256)  # used if the phone/PC asks for a bigger MTU (faster storage transfers)
except Exception:
    pass
((note_handle, data_handle),) = ble.gatts_register_services(
    ((SERVICE_UUID, (
        (NOTE_UUID, _FLAG_WRITE | _FLAG_WRITE_NO_RESPONSE),
        (DATA_UUID, _FLAG_WRITE | _FLAG_WRITE_NO_RESPONSE | _FLAG_NOTIFY),
    )),)
)
# Storage writes append to this buffer until the handler reads them (several may
# arrive before it runs), so none are lost
ble.gatts_set_buffer(data_handle, 4096, True)
store.open_db()
ble.irq(on_ble)
advertise()
set_led(False)
play_chirp(CHIRPS["ready"])
print("Advertising as", DEVICE_NAME, "- open the web piano and press Connect")

try:
    while True:
        if requests:
            serve(requests.pop(0))
        if chirp:
            name, chirp = chirp, None
            play_chirp(CHIRPS[name])
        time.sleep_ms(20)
finally:
    # Always leave the buzzer quiet, even after Ctrl-C
    set_duty(0)
    pwm.deinit()
    set_led(False)
    ble.active(False)
    store.close_db()  # frees its C memory, so running main.py again (mpremote) doesn't leak it
