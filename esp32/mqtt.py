# Minimal MQTT 3.1.1 client for the board (MicroPython), also runs on CPython (tests, simulator).
# What the board needs and nothing more: connect (user/password, keep-alive, last will) over TLS,
# subscribe, publish with QoS 0 or 1, receive publishes, ping. The firmware has no MQTT library.
#
#   c = MQTT("board-piano1", "piano-esp32.duckdns.org", 8883, user, password, tls=context)
#   c.connect(will=("piano/piano1/status", b'{"online":false}', True))
#   c.subscribe("piano/piano1/#")
#   while True:
#       msg = c.check(20)          # (topic, payload) or None after waiting up to 20 ms
#       c.keepalive()              # sends a ping when one is due
#
# The packet functions (connect_packet, publish_packet…) are pure, so they're tested on the laptop.

import socket
import struct
import time

try:
    import select
except ImportError:  # some MicroPython ports
    select = None

CONNECT, CONNACK, PUBLISH, PUBACK, SUBSCRIBE, SUBACK, PINGREQ, PINGRESP, DISCONNECT = (
    0x10,
    0x20,
    0x30,
    0x40,
    0x82,
    0x90,
    0xC0,
    0xD0,
    0xE0,
)
CONNACK_ERRORS = {
    1: "bad protocol version",
    2: "client id rejected",
    3: "broker unavailable",
    4: "bad user name or password",
    5: "not authorised",
}


class MQTTError(OSError):
    pass


def _ticks_ms():
    return time.ticks_ms() if hasattr(time, "ticks_ms") else int(time.monotonic() * 1000)


def _ticks_diff(a, b):
    return time.ticks_diff(a, b) if hasattr(time, "ticks_diff") else a - b


# ---- Packets -------------------------------------------------------------------------------------
def varint(n):
    """MQTT "remaining length": 7 bits per byte, high bit = more."""
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        out.append(b | 0x80 if n else b)
        if not n:
            return bytes(out)


def _str(s):
    b = s.encode() if isinstance(s, str) else bytes(s)
    return struct.pack("!H", len(b)) + b


def _packet(first, body):
    return bytes([first]) + varint(len(body)) + body


def connect_packet(client_id, user=None, password=None, keepalive=60, will=None, clean=True):
    """will = (topic, payload, retain) or None."""
    flags = 0x02 if clean else 0
    payload = _str(client_id)
    if will:
        flags |= 0x04 | (0x20 if will[2] else 0)
        payload += _str(will[0]) + _str(will[1])
    if user is not None:
        flags |= 0x80
        payload += _str(user)
    if password is not None:
        flags |= 0x40
        payload += _str(password)
    return _packet(CONNECT, _str("MQTT") + bytes([4, flags]) + struct.pack("!H", keepalive) + payload)


def publish_packet(topic, payload, retain=False, qos=0, pid=0):
    first = PUBLISH | (qos << 1) | (1 if retain else 0)
    body = _str(topic) + (struct.pack("!H", pid) if qos else b"") + payload
    return _packet(first, body)


def subscribe_packet(topic, qos=0, pid=1):
    return _packet(SUBSCRIBE, struct.pack("!H", pid) + _str(topic) + bytes([qos]))


def parse_publish(first, body):
    """(topic, payload, qos, packet id) of a PUBLISH packet's first byte and body."""
    n = struct.unpack("!H", body[:2])[0]
    topic = bytes(body[2 : 2 + n]).decode()
    qos = (first >> 1) & 3
    i = 2 + n
    pid = 0
    if qos:
        pid = struct.unpack("!H", body[i : i + 2])[0]
        i += 2
    return topic, bytes(body[i:]), qos, pid


# ---- Client --------------------------------------------------------------------------------------
class MQTT:
    def __init__(
        self,
        client_id,
        host,
        port=8883,
        user=None,
        password=None,
        keepalive=60,
        tls=None,
        server_hostname=None,
        address=None,
    ):
        """tls: an ssl.SSLContext (None = plain TCP). address: connect to this IP instead of
        resolving host (the certificate is still checked against host)."""
        self.client_id, self.host, self.port = client_id, host, port
        self.user, self.password, self.keepalive_s = user, password, keepalive
        self.tls, self.server_hostname, self.address = tls, server_hostname or host, address
        self.sock = None
        self._pid = 0
        self._last_out = 0
        self._ping_sent = None

    # Socket helpers that work with MicroPython's (read/write) and CPython's (recv/sendall) sockets
    def _write(self, data):
        if hasattr(self.sock, "sendall"):
            self.sock.sendall(data)
        else:
            view = memoryview(data)
            while view:
                n = self.sock.write(view)
                if n is None:  # buffers full, try again
                    time.sleep_ms(5)
                    continue
                view = view[n:]
        self._last_out = _ticks_ms()

    def _read(self, n):
        out = b""
        while len(out) < n:
            chunk = (
                self.sock.recv(n - len(out)) if hasattr(self.sock, "recv") else self.sock.read(n - len(out))
            )
            if not chunk:
                raise MQTTError("connection closed by the broker")
            out += chunk
        return out

    def _read_packet(self, first=None):
        """(first byte, body) of the next packet; blocks (up to the socket timeout)."""
        if first is None:
            first = self._read(1)[0]
        n, shift = 0, 0
        while True:
            b = self._read(1)[0]
            n |= (b & 0x7F) << shift
            shift += 7
            if not b & 0x80:
                break
        return first, self._read(n) if n else b""

    def connect(self, will=None, timeout=10):
        """Open the connection (TLS if configured) and log in. will = (topic, payload, retain)."""
        addr = socket.getaddrinfo(self.address or self.host, self.port)[0][-1]
        s = socket.socket()
        s.settimeout(timeout)
        s.connect(addr)
        if self.tls is not None:
            s = self.tls.wrap_socket(s, server_hostname=self.server_hostname)
        self.sock = s
        self._poll = None
        if select is not None and hasattr(select, "poll"):
            self._poll = select.poll()
            self._poll.register(s, select.POLLIN)
        self._write(connect_packet(self.client_id, self.user, self.password, self.keepalive_s, will))
        first, body = self._read_packet()
        if first != CONNACK or len(body) != 2:
            raise MQTTError("expected CONNACK")
        if body[1]:
            raise MQTTError("broker refused: " + CONNACK_ERRORS.get(body[1], str(body[1])))
        self._ping_sent = None

    def close(self):
        if self.sock is not None:
            try:
                self._write(bytes([DISCONNECT, 0]))
            except OSError:
                pass
            try:
                self.sock.close()
            except OSError:
                pass
            self.sock = None

    def _next_pid(self):
        self._pid = self._pid % 0xFFFF + 1
        return self._pid

    def publish(self, topic, payload, retain=False, qos=0):
        """QoS 1: the broker's PUBACK is read later by check() (no waiting here)."""
        self._write(publish_packet(topic, payload, retain, qos, self._next_pid() if qos else 0))

    def subscribe(self, topic, qos=0):
        self._write(subscribe_packet(topic, qos, self._next_pid()))
        first, body = self._read_packet()
        while first != SUBACK:  # a retained message may arrive first: handle it later
            self._pending = (first, body)
            first, body = self._read_packet()
        if body[-1] == 0x80:
            raise MQTTError("subscription refused: " + topic)

    def _readable(self, wait_ms):
        if hasattr(self.sock, "pending") and self.sock.pending():  # CPython TLS: already decrypted
            return True
        if self._poll is None:
            return True  # no poll: block on the read (the socket timeout limits it)
        return bool(self._poll.poll(wait_ms))

    def check(self, wait_ms=0):
        """The next message as (topic, payload), or None if none arrived within wait_ms.
        Also answers the broker (PUBACK for QoS 1, PINGRESP)."""
        pending = getattr(self, "_pending", None)
        if pending is not None:
            self._pending = None
            first, body = pending
        else:
            if not self._readable(wait_ms):
                return None
            first, body = self._read_packet()
        kind = first & 0xF0
        if kind == PUBLISH:
            topic, payload, qos, pid = parse_publish(first, body)
            if qos == 1:
                self._write(bytes([PUBACK, 2]) + struct.pack("!H", pid))
            return topic, payload
        if kind == PINGRESP:
            self._ping_sent = None
        return None

    def keepalive(self):
        """Ping when the connection has been quiet; raise if the broker stopped answering."""
        now = _ticks_ms()
        if self._ping_sent is not None and _ticks_diff(now, self._ping_sent) > self.keepalive_s * 1000:
            raise MQTTError("the broker stopped answering")
        if self._ping_sent is None and _ticks_diff(now, self._last_out) > self.keepalive_s * 500:
            self._write(bytes([PINGREQ, 0]))
            self._ping_sent = now
