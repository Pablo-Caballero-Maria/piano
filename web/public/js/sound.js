// The one sound output: every mode calls output(f), which sends f to the ESP32 and,
// with "Device sound" on, plays the same square wave on this phone/PC. Also the
// metronome click (device speaker only, so it never reaches the buzzer).
import * as ble from "./ble.js";

let current = 0;
let soundOn = false;
try { soundOn = localStorage.getItem("piano-sound") === "1"; } catch {}

let ctx = null, osc = null, gain = null;
const listeners = new Set();

/** Play f Hz (0 = silence) on the buzzer and the device; does nothing if f is already playing. */
export function output(f) {
  f = Math.max(0, Math.min(65535, Math.round(f)));
  if (f === current) return;
  current = f;
  ble.send(f);
  localTone(f);
  for (const fn of listeners) fn(f);
}

export const currentFreq = () => current;
/** Call fn(f) whenever the output frequency changes. */
export const onOutput = (fn) => listeners.add(fn);

export const deviceSound = () => soundOn;

/** Turn the device speaker on/off (remembered in localStorage). Call from a user gesture. */
export function setDeviceSound(on) {
  soundOn = on;
  try { localStorage.setItem("piano-sound", on ? "1" : "0"); } catch {}
  if (on) unlockAudio();
  localTone(on ? current : 0);
}

/**
 * Browsers only allow audio after a user gesture, so the AudioContext is created on
 * the first key press / button press. Safe to call often.
 */
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    osc = ctx.createOscillator();
    osc.type = "square";
    gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
  }
  if (ctx.state === "suspended") ctx.resume();
}

/** Play f Hz (0 = silence) on this device, with short ramps to avoid clicks. */
function localTone(f) {
  if (!ctx) return;
  const t = ctx.currentTime;
  gain.gain.cancelScheduledValues(t);
  if (f && soundOn) {
    osc.frequency.setValueAtTime(f, t);
    gain.gain.setTargetAtTime(0.06, t, 0.004);
  } else {
    gain.gain.setTargetAtTime(0, t, 0.01);
  }
}

/** A short metronome tick on the device speaker (higher on the first beat of a bar). */
export function click(accent) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = accent ? 1760 : 1175;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.25, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.06);
}
