# The passive buzzer: holds one frequency until told otherwise (it can only play one note).
# The teacher's PC sends the frequency to play on piano/<board>/tone (2 bytes, little-endian Hz,
# 0 = silence); whoever holds the buzzer in the class decides what that is (fog/classroom.py).

import time

from machine import PWM, Pin

VOLUME = 0.5  # PWM duty cycle 0.0-0.5 (0.5 is the loudest for a passive buzzer)
CHIRPS = {
    "ready": (1047, 1319, 1568),  # C6 E6 G6: started
    "online": (1568, 2093),  # G6 C7: connected to the teacher's PC
    "offline": (2093, 1568),  # C7 G6: lost it
}


class Buzzer:
    def __init__(self, pin):
        self.pwm = PWM(Pin(pin), freq=440)
        self.freq = 0
        self._duty(0)

    def _duty(self, fraction):
        # Newer firmware has duty_u16 (0-65535); older ESP32 builds only have duty (0-1023)
        if hasattr(self.pwm, "duty_u16"):
            self.pwm.duty_u16(int(fraction * 65535))
        else:
            self.pwm.duty(int(fraction * 1023))

    def play(self, freq):
        """Hold freq Hz (clamped to 20-20000) until the next call; 0 = silence."""
        if freq == self.freq:
            return
        self.freq = freq
        if freq <= 0:
            self._duty(0)
        else:
            self.pwm.freq(min(max(freq, 20), 20000))
            self._duty(VOLUME)

    def chirp(self, name):
        """A short signal (blocks ~200 ms), then silence."""
        for f in CHIRPS.get(name, ()):
            self.play(f)
            time.sleep_ms(70)
        self.play(0)

    def off(self):
        self.play(0)
        self.pwm.deinit()
