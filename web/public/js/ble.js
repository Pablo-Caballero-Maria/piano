// Web Bluetooth link to the ESP32 (protocol: see README.md and esp32/main.py).
// Two characteristics: NOTE (the frequency to play, 2 bytes) and DATA (storage
// requests for accounts and melodies, which live on the ESP32's flash).

// Must match esp32/main.py and tools/fake_esp32.py
const DEVICE_NAME = "ESP32-Piano";
const SERVICE_UUID = "7a3e0001-5c2b-4f8e-9d61-3b2f1c9a8e10";
const NOTE_UUID = "7a3e0002-5c2b-4f8e-9d61-3b2f1c9a8e10";
const DATA_UUID = "7a3e0003-5c2b-4f8e-9d61-3b2f1c9a8e10";
const MAX_MSG = 24000; // the ESP32 rejects bigger requests

export const available = !!navigator.bluetooth;

let device = null, noteChar = null, dataChar = null;
let latest = 0;               // newest frequency asked for (also while disconnected)
let onStatus = () => {};
const connectionListeners = new Set();

/** Register fn(state, text, hasDevice); state is idle | connecting | connected | error. */
export function setStatusHandler(fn) { onStatus = fn; }

/** Call fn(true) once connected (and the storage link is ready), fn(false) on disconnect. */
export const onConnectionChange = (fn) => connectionListeners.add(fn);

export const connected = () => !!noteChar && !!device?.gatt.connected;

/** True if the connected board can store accounts and melodies (firmware with store.py). */
export const hasStorage = () => connected() && !!dataChar;

let connecting = null;

/** Pick the ESP32 (first time only), connect, and set up both characteristics. Resolves when done. */
export function connect() {
  connecting ??= doConnect().finally(() => (connecting = null));
  return connecting;
}

async function doConnect() {
  try {
    onStatus("connecting", "Connecting…", !!device);
    if (!device) {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ name: DEVICE_NAME }, { services: [SERVICE_UUID] }],
        optionalServices: [SERVICE_UUID],
      });
      device.addEventListener("gattserverdisconnected", onDisconnected);
    }
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    noteChar = await service.getCharacteristic(NOTE_UUID);
    await setupData(service);
    onStatus("connected", `Connected to ${device.name || DEVICE_NAME}`, true);
    send(latest); // whatever should be sounding now (normally silence)
    for (const fn of connectionListeners) await Promise.resolve(fn(true)).catch((e) => console.warn(e));
  } catch (err) {
    noteChar = dataChar = null;
    if (err.name === "NotFoundError" && !device) onStatus("idle", "Not connected", false); // chooser cancelled
    else onStatus("error", `Couldn't connect: ${err.message}`, !!device);
  }
}

function onDisconnected() {
  noteChar = dataChar = null;
  rxBuf = new Uint8Array(0);
  failPending(new Error("The ESP32 disconnected"));
  onStatus("idle", "Disconnected", true);
  for (const fn of connectionListeners) fn(false);
}

export function disconnect() { device?.gatt.disconnect(); }

// ---- One GATT write at a time ------------------------------------------------------
// Notes and storage chunks share this queue, so a note waits for at most one chunk.
let gattChain = Promise.resolve();
function gattWrite(char, data) {
  const run = () => char.properties.writeWithoutResponse
    ? char.writeValueWithoutResponse(data)
    : char.writeValueWithResponse(data);
  const p = gattChain.then(run, run);
  gattChain = p.catch(() => {});
  return p;
}

// ---- Notes ------------------------------------------------------------------------------
// While one note is sending, keep just the newest frequency: the buzzer only cares
// about the latest state, and this keeps latency low instead of building a backlog.
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
    try {
      await gattWrite(noteChar, new Uint8Array([f & 0xff, f >> 8])); // uint16 little-endian, 0 = silence
    } catch (err) {
      console.warn("BLE write failed", err);
    }
  }
  writing = false;
}

// ---- Storage requests ---------------------------------------------------------------------
// Each message (both ways) = 4-byte little-endian length + JSON. Requests are written in
// chunks of (MTU - 3) bytes; the answer comes back as notifications of the same size.
let chunk = 20;                 // safe for any MTU; raised after "hello"
let rxBuf = new Uint8Array(0);
let pending = null;             // {resolve, reject} of the request waiting for its answer
let reqChain = Promise.resolve();
let reqId = 0;

async function setupData(service) {
  dataChar = null;
  chunk = 20;
  rxBuf = new Uint8Array(0);
  let c;
  try {
    c = await service.getCharacteristic(DATA_UUID);
  } catch {
    console.warn("This ESP32 firmware has no storage characteristic (old main.py?)");
    return;
  }
  c.addEventListener("characteristicvaluechanged", onData);
  await c.startNotifications();
  dataChar = c;
  try {
    const hello = await request("hello");
    chunk = Math.max(20, Math.min(500, (hello.mtu || 23) - 3));
  } catch (err) {
    console.warn("Storage hello failed", err);
  }
}

function onData(e) {
  const v = e.target.value;
  const add = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  const buf = new Uint8Array(rxBuf.length + add.length);
  buf.set(rxBuf);
  buf.set(add, rxBuf.length);
  rxBuf = buf;
  while (rxBuf.length >= 4) {
    const size = new DataView(rxBuf.buffer, rxBuf.byteOffset).getUint32(0, true);
    if (rxBuf.length < 4 + size) return;
    const text = new TextDecoder().decode(rxBuf.subarray(4, 4 + size));
    rxBuf = rxBuf.slice(4 + size);
    let res;
    try { res = JSON.parse(text); } catch { res = { ok: false, error: "Garbled answer from the ESP32" }; }
    const p = pending;
    pending = null;
    if (!p) continue;
    if (res.ok) p.resolve(res);
    else p.reject(Object.assign(new Error(res.error || "ESP32 error"), { status: res.code }));
  }
}

function failPending(err) {
  const p = pending;
  pending = null;
  p?.reject(err);
}

/**
 * Send storage request {op, ...args} to the ESP32 and resolve with its answer.
 * One request at a time; throws Error(message) with .status (401, 404…) on failure.
 */
export function request(op, args = {}) {
  const run = () => doRequest(op, args);
  const p = reqChain.then(run, run);
  reqChain = p.catch(() => {});
  return p;
}

async function doRequest(op, args) {
  if (!connected()) throw Object.assign(new Error("Connect the ESP32 first"), { status: 0 });
  if (!dataChar) throw Object.assign(new Error("This ESP32 can't store melodies: install the new esp32/main.py and store.py"), { status: 0 });
  const body = new TextEncoder().encode(JSON.stringify({ id: ++reqId, op, t: Date.now(), ...args }));
  if (body.length > MAX_MSG) throw Object.assign(new Error("Too big for the ESP32"), { status: 413 });
  const msg = new Uint8Array(4 + body.length);
  new DataView(msg.buffer).setUint32(0, body.length, true);
  msg.set(body, 4);

  const answer = new Promise((resolve, reject) => (pending = { resolve, reject }));
  answer.catch(() => {}); // awaited below; this only avoids an "unhandled rejection" if a write fails first
  // ~1 KB/s at the smallest MTU, plus time to write the flash
  const timer = setTimeout(() => failPending(new Error("The ESP32 didn't answer")), 15000 + msg.length * 2);
  try {
    for (let i = 0; i < msg.length; i += chunk) {
      if (!dataChar) throw new Error("The ESP32 disconnected");
      await gattWrite(dataChar, msg.slice(i, i + chunk));
    }
    return await answer;
  } catch (err) {
    failPending(err);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
