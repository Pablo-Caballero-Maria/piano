// Web Bluetooth link to the ESP32 (protocol: see README.md and esp32/main.py).

// Must match esp32/main.py and tools/fake_esp32.py
const DEVICE_NAME = "ESP32-Piano";
const SERVICE_UUID = "7a3e0001-5c2b-4f8e-9d61-3b2f1c9a8e10";
const NOTE_UUID = "7a3e0002-5c2b-4f8e-9d61-3b2f1c9a8e10";

export const available = !!navigator.bluetooth;

let device = null, noteChar = null;
let latest = 0;               // newest frequency asked for (also while disconnected)
let onStatus = () => {};

/** Register fn(state, text, hasDevice); state is idle | connecting | connected | error. */
export function setStatusHandler(fn) { onStatus = fn; }

export const connected = () => !!noteChar && !!device?.gatt.connected;

/** Pick the ESP32 (first time only), connect to its GATT server and find the note characteristic. */
export async function connect() {
  try {
    onStatus("connecting", "Connecting…", !!device);
    if (!device) {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ name: DEVICE_NAME }, { services: [SERVICE_UUID] }],
        optionalServices: [SERVICE_UUID],
      });
      device.addEventListener("gattserverdisconnected", () => {
        noteChar = null;
        onStatus("idle", "Disconnected", true);
      });
    }
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    noteChar = await service.getCharacteristic(NOTE_UUID);
    onStatus("connected", `Connected to ${device.name || DEVICE_NAME}`, true);
    send(latest); // whatever should be sounding now (normally silence)
  } catch (err) {
    noteChar = null;
    if (err.name === "NotFoundError" && !device) onStatus("idle", "Not connected", false); // chooser cancelled
    else onStatus("error", `Couldn't connect: ${err.message}`, !!device);
  }
}

export function disconnect() { device?.gatt.disconnect(); }

// Only one GATT write can be in flight. While one is sending, keep just the
// newest frequency: the buzzer only cares about the latest state, and this
// keeps latency low instead of letting a backlog build up.
let writing = false, queued = null;

/** Queue frequency f (Hz, 0 = silence) for the ESP32; just remembered while disconnected. */
export function send(f) {
  latest = f;
  if (!noteChar) return;
  queued = f;
  if (!writing) flush();
}

/** Write queued frequencies one at a time until nothing newer is waiting. */
async function flush() {
  writing = true;
  while (queued !== null && noteChar) {
    const f = queued;
    queued = null;
    const data = new Uint8Array([f & 0xff, f >> 8]); // uint16 little-endian, 0 = silence
    try {
      if (noteChar.properties.writeWithoutResponse) await noteChar.writeValueWithoutResponse(data);
      else await noteChar.writeValueWithResponse(data);
    } catch (err) {
      console.warn("BLE write failed", err);
    }
  }
  writing = false;
}
