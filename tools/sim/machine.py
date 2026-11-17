"""Stand-in for MicroPython's ``machine`` module (simulated board): the buzzer's PWM reports what
it plays through ``on_tone``; ``reset()`` raises :class:`Reset` for the simulator to restart."""

on_tone = None  # callback(freq Hz, 0 = silence), set by tools/fake_board.py


class Reset(Exception):
    """machine.reset() was called."""


def reset():
    raise Reset()


class Pin:
    OUT = 1
    IN = 0

    def __init__(self, n, mode=None):
        self.n, self._v = n, 0

    def value(self, v=None):
        if v is None:
            return self._v
        self._v = v


class PWM:
    def __init__(self, pin, freq=440):
        self._freq, self._duty = freq, 0

    def freq(self, f=None):
        if f is None:
            return self._freq
        self._freq = f
        self._report()

    def duty_u16(self, d=None):
        if d is None:
            return self._duty
        self._duty = d
        self._report()

    def _report(self):
        if on_tone:
            on_tone(self._freq if self._duty else 0)

    def deinit(self):
        self._duty = 0


class RTC:
    def datetime(self, t=None):
        return t
