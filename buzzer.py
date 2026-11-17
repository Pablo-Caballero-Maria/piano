# Play sounds on a buzzer connected to an ESP32 (MicroPython).
# Run from the laptop with:  mpremote connect /dev/ttyUSB0 run buzzer.py

import time

from machine import PWM, Pin

BUZZER_PIN = 33  # GPIO (board label D33) the buzzer module's S pin is wired to
VOLUME = 0.1  # PWM duty cycle 0.0-0.5 (0.5 is the loudest for a passive buzzer)

# Note frequencies in Hz (4th to 6th octave)
NOTES = {
    "C4": 262,
    "CS4": 277,
    "D4": 294,
    "DS4": 311,
    "E4": 330,
    "F4": 349,
    "FS4": 370,
    "G4": 392,
    "GS4": 415,
    "A4": 440,
    "AS4": 466,
    "B4": 494,
    "C5": 523,
    "CS5": 554,
    "D5": 587,
    "DS5": 622,
    "E5": 659,
    "F5": 698,
    "FS5": 740,
    "G5": 784,
    "GS5": 831,
    "A5": 880,
    "AS5": 932,
    "B5": 988,
    "C6": 1047,
    "R": 0,  # rest
}

pwm = PWM(Pin(BUZZER_PIN), freq=440)


def set_duty(fraction):
    """Set the PWM duty cycle as a fraction (0.0-1.0); 0 silences the buzzer."""
    # Newer firmware has duty_u16 (0-65535); older ESP32 builds only have duty (0-1023)
    if hasattr(pwm, "duty_u16"):
        pwm.duty_u16(int(fraction * 65535))
    else:
        pwm.duty(int(fraction * 1023))


def tone(freq, ms):
    """Play `freq` Hz (0 or less = silence) for `ms` milliseconds."""
    if freq <= 0:
        set_duty(0)
    else:
        pwm.freq(int(freq))
        set_duty(VOLUME)
    time.sleep_ms(ms)


def silence(ms=0):
    """Silence the buzzer, then wait `ms` milliseconds."""
    set_duty(0)
    time.sleep_ms(ms)


def play(melody, tempo=120):
    """melody: list of (note_name, beats). One beat = a quarter note at `tempo` BPM."""
    beat_ms = 60000 // tempo
    for note, beats in melody:
        length = int(beat_ms * beats)
        # Short gap between notes so repeated notes don't blur together
        tone(NOTES[note], int(length * 0.9))
        silence(int(length * 0.1))


def beeps(count=3, freq=2000, on_ms=100, off_ms=100):
    """`count` short beeps at `freq` Hz."""
    for _ in range(count):
        tone(freq, on_ms)
        silence(off_ms)


def siren(cycles=2):
    """Sweep 600 -> 1500 -> 600 Hz, `cycles` times."""
    for _ in range(cycles):
        for f in range(600, 1500, 20):
            tone(f, 8)
        for f in range(1500, 600, -20):
            tone(f, 8)
    silence()


def scale():
    """C major scale, C5 to C6."""
    for note in ("C5", "D5", "E5", "F5", "G5", "A5", "B5", "C6"):
        tone(NOTES[note], 180)
        silence(20)
    silence()


TWINKLE = [
    ("C5", 1),
    ("C5", 1),
    ("G5", 1),
    ("G5", 1),
    ("A5", 1),
    ("A5", 1),
    ("G5", 2),
    ("F5", 1),
    ("F5", 1),
    ("E5", 1),
    ("E5", 1),
    ("D5", 1),
    ("D5", 1),
    ("C5", 2),
]

ODE_TO_JOY = [
    ("E5", 1),
    ("E5", 1),
    ("F5", 1),
    ("G5", 1),
    ("G5", 1),
    ("F5", 1),
    ("E5", 1),
    ("D5", 1),
    ("C5", 1),
    ("C5", 1),
    ("D5", 1),
    ("E5", 1),
    ("E5", 1.5),
    ("D5", 0.5),
    ("D5", 2),
]


def main():
    """Run every demo once, always leaving the buzzer silent at the end."""
    try:
        print("Beeps")
        beeps()
        time.sleep_ms(400)

        print("Scale")
        scale()
        time.sleep_ms(400)

        print("Siren")
        siren()
        time.sleep_ms(400)

        print("Twinkle Twinkle Little Star")
        play(TWINKLE, tempo=140)
        time.sleep_ms(400)

        print("Ode to Joy")
        play(ODE_TO_JOY, tempo=140)
    finally:
        # Always leave the buzzer quiet, even after Ctrl-C
        silence()
        pwm.deinit()
    print("Done")


main()
