# Bluetooth (BLE) piano receiver for an ESP32 + buzzer (MicroPython).
# The web app (web/public/js/ble.js) writes the frequency to play; the buzzer holds it
# until the next write. A frequency of 0 means silence.
#
# Test without installing:      mpremote connect /dev/ttyUSB0 run esp32/main.py
# Install to start on power-up: mpremote connect /dev/ttyUSB0 cp esp32/main.py :main.py + reset

import bluetooth
import struct
import time
from machine import Pin, PWM
from micropython import const

BUZZER_PIN = 33   # GPIO (board label D33) the buzzer module's S pin is wired to
LED_PIN = 2       # On-board LED, lit while a phone/PC is connected (None to disable)
VOLUME = 0.5      # PWM duty cycle 0.0-0.5 (0.5 is the loudest for a passive buzzer)
DEVICE_NAME = "ESP32-Piano"

# Must match SERVICE_UUID / NOTE_UUID in web/public/js/ble.js
SERVICE_UUID = bluetooth.UUID("7a3e0001-5c2b-4f8e-9d61-3b2f1c9a8e10")
NOTE_UUID = bluetooth.UUID("7a3e0002-5c2b-4f8e-9d61-3b2f1c9a8e10")

_IRQ_CENTRAL_CONNECT = const(1)
_IRQ_CENTRAL_DISCONNECT = const(2)
_IRQ_GATTS_WRITE = const(3)
_FLAG_WRITE_NO_RESPONSE = const(0x0004)
_FLAG_WRITE = const(0x0008)

# Advertising packet: flags + device name. The 128-bit service UUID doesn't fit
# alongside the name in 31 bytes, so it goes in the scan response.
_name = DEVICE_NAME.encode()
ADV_DATA = bytes((2, 0x01, 0x06)) + bytes((len(_name) + 1, 0x09)) + _name
RESP_DATA = bytes((17, 0x07)) + bytes(SERVICE_UUID)

pwm = PWM(Pin(BUZZER_PIN), freq=440)
led = Pin(LED_PIN, Pin.OUT) if LED_PIN is not None else None
current_freq = 0
chirp = None  # chirp queued by the BLE handler, played from the main loop


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


def on_ble(event, data):
    """BLE IRQ handler: connect/disconnect bookkeeping and note writes (played immediately)."""
    global chirp
    if event == _IRQ_CENTRAL_CONNECT:
        set_led(True)
        chirp = "connect"
        print("Connected")
    elif event == _IRQ_CENTRAL_DISCONNECT:
        # Never leave a note stuck on if the phone walks away mid-note
        play(0)
        set_led(False)
        chirp = "disconnect"
        print("Disconnected, advertising again")
        advertise()
    elif event == _IRQ_GATTS_WRITE:
        _, handle = data
        if handle == note_handle:
            msg = ble.gatts_read(note_handle)
            if len(msg) >= 2:
                # 2 bytes, little-endian: frequency in Hz (0 = silence)
                play(struct.unpack_from("<H", msg)[0])


set_duty(0)
ble = bluetooth.BLE()
ble.active(True)
try:
    ble.config(gap_name=DEVICE_NAME)
except Exception:
    pass  # older firmware; the advertised name is what the browser sees anyway
((note_handle,),) = ble.gatts_register_services(
    ((SERVICE_UUID, ((NOTE_UUID, _FLAG_WRITE | _FLAG_WRITE_NO_RESPONSE),)),)
)
ble.irq(on_ble)
advertise()
set_led(False)
play_chirp(CHIRPS["ready"])
print("Advertising as", DEVICE_NAME, "- open the web piano and press Connect")

try:
    while True:
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
