# MQTT packets of the board's client (esp32/mqtt.py), byte by byte against the MQTT 3.1.1 spec.
import mqtt


def test_varint():
    assert mqtt.varint(0) == b"\x00"
    assert mqtt.varint(127) == b"\x7f"
    assert mqtt.varint(128) == b"\x80\x01"
    assert mqtt.varint(16383) == b"\xff\x7f"
    assert mqtt.varint(2097151) == b"\xff\xff\x7f"


def test_connect():
    p = mqtt.connect_packet("b1", "user", "pw", 30, will=("t/s", b"off", True))
    assert p[0] == mqtt.CONNECT
    body = p[2:]
    assert body[:6] == b"\x00\x04MQTT" and body[6] == 4
    assert body[7] == 0x80 | 0x40 | 0x20 | 0x04 | 0x02  # user, password, will retain, will, clean
    assert body[8:10] == b"\x00\x1e"
    assert body[10:] == b"\x00\x02b1" + b"\x00\x03t/s" + b"\x00\x03off" + b"\x00\x04user" + b"\x00\x02pw"
    assert mqtt.connect_packet("b1")[9] == 0x02  # no user, no will: just "clean session"


def test_publish_and_parse():
    p = mqtt.publish_packet("a/b", b"\x01\x02", retain=True)
    assert p == bytes([0x31, 7]) + b"\x00\x03a/b\x01\x02"
    q = mqtt.publish_packet("a/b", b"x", qos=1, pid=258)
    assert q[0] == 0x32 and q[2:] == b"\x00\x03a/b\x01\x02x"
    assert mqtt.parse_publish(q[0], q[2:]) == ("a/b", b"x", 1, 258)
    assert mqtt.parse_publish(p[0], p[2:]) == ("a/b", b"\x01\x02", 0, 0)


def test_subscribe():
    assert mqtt.subscribe_packet("x/#", 1, pid=5) == bytes([0x82, 8]) + b"\x00\x05\x00\x03x/#\x01"
