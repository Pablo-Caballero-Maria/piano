// Page wiring: header (Bluetooth, device sound, account), Piano / Studio modes,
// and routing the computer keyboard to the active mode.
import * as ble from "./ble.js";
import { output, deviceSound, setDeviceSound, unlockAudio } from "./sound.js";
import { freqOf, noteName } from "./notes.js";
import { Keyboard } from "./keyboard.js";
import * as api from "./api.js";
import { initAuthDialog, openAuth, toast, icon } from "./ui.js";
import { initStudio, setStudioActive, studioKeyDown, studioKeyUp, panic } from "./studio.js";

const $ = (id) => document.getElementById(id);
let mode = "piano";

// ---- Piano mode -----------------------------------------------------------------
// The buzzer can only play one note at a time, so the most recently pressed
// held note sounds; releasing it falls back to the previous one still held.
const held = []; // midi notes in press order (duplicates allowed)

const pianoKb = new Keyboard({
  el: $("keyboard"), wrap: $("wrap"), range: $("range"), octDown: $("octDown"), octUp: $("octUp"),
  onDown: (m) => { unlockAudio(); held.push(m); updatePiano(); },
  onUp: (m) => {
    const i = held.lastIndexOf(m);
    if (i >= 0) held.splice(i, 1);
    updatePiano();
  },
});

function updatePiano() {
  const m = held.length ? held[held.length - 1] : 0;
  pianoKb.setSounding(m ? [m] : []);
  if (mode !== "piano") return;
  const f = m ? freqOf(m) : 0;
  output(f);
  $("now").innerHTML = m ? `${noteName(m)}<small>${f} Hz</small>` : "–";
}

// ---- Modes ------------------------------------------------------------------------
function setMode(m) {
  if (m !== "piano" && m !== "studio") m = "piano";
  if (m === mode && document.body.dataset.mode === m) return;
  // Silence the mode we leave
  if (mode === "piano") pianoKb.releaseAll();
  else setStudioActive(false);
  output(0);

  mode = m;
  document.body.dataset.mode = m;
  $("pianoView").hidden = m !== "piano";
  $("studioView").hidden = m !== "studio";
  for (const t of document.querySelectorAll(".tabs [data-mode]")) t.setAttribute("aria-selected", t.dataset.mode === m);
  try { localStorage.setItem("piano-mode", m); } catch {}
  if (location.hash !== `#${m}`) history.replaceState(null, "", `#${m}`);
  if (m === "studio") setStudioActive(true);
  else { pianoKb.fit(); updatePiano(); }
}

for (const t of document.querySelectorAll(".tabs [data-mode]")) t.onclick = () => setMode(t.dataset.mode);
addEventListener("hashchange", () => setMode(location.hash.slice(1)));

// ---- Computer keyboard ------------------------------------------------------------
addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, select, textarea") || document.querySelector("dialog[open]")) return;
  if (mode === "studio") {
    if (e.code === "Space") document.activeElement?.blur?.(); // so Space doesn't also "click" the focused button
    if (studioKeyDown(e)) unlockAudio();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (pianoKb.keyDown(e)) unlockAudio();
});
addEventListener("keyup", (e) => {
  if (mode === "studio") {
    if (e.code === "Space" && !e.target.closest?.("input, select, textarea")) e.preventDefault();
    studioKeyUp(e);
  } else pianoKb.keyUp(e);
});

// Don't leave a note stuck on when the app loses focus
function releaseEverything() {
  pianoKb.releaseAll();
  panic();
}
addEventListener("blur", releaseEverything);
document.addEventListener("visibilitychange", () => { if (document.hidden) releaseEverything(); });

// ---- Bluetooth ----------------------------------------------------------------------
ble.setStatusHandler((state, text, hasDevice) => {
  $("status").dataset.state = state;
  $("statusText").textContent = text;
  const btn = $("connect");
  btn.textContent = state === "connected" ? "Disconnect" : hasDevice ? "Reconnect" : "Connect ESP32";
  btn.classList.toggle("primary", state !== "connected");
  btn.disabled = state === "connecting";
});

$("connect").onclick = () => (ble.connected() ? ble.disconnect() : ble.connect());

if (!ble.available) {
  const n = $("notice");
  n.hidden = false;
  const linuxChrome = /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent) && /Chrome/.test(navigator.userAgent);
  n.innerHTML = !window.isSecureContext
    ? "Bluetooth needs a secure (https://) page. Open the published Vercel link instead of the local file."
    : linuxChrome
    ? "Chrome on Linux has Bluetooth turned off by default. Open <b>chrome://flags/#enable-web-bluetooth</b> " +
      "(or <b>#enable-experimental-web-platform-features</b>), set it to <b>Enabled</b> and relaunch Chrome. " +
      "BlueZ must be running (<code>systemctl status bluetooth</code>)."
    : "This browser can't use Bluetooth. Use <b>Chrome</b> or <b>Edge</b> on Android, Windows, macOS or Linux " +
      "(on iPhone/iPad, use the <b>Bluefy</b> app). You can still play here with device sound.";
  $("connect").disabled = true;
}

// ---- Device sound -----------------------------------------------------------------------
function renderSound() {
  const on = deviceSound();
  $("sound").setAttribute("aria-pressed", on);
  $("sound").innerHTML = icon(on ? "vol" : "mute");
  $("sound").title = on ? "Device sound on: notes also play on this phone/PC" : "Device sound off: notes only play on the ESP32";
}
$("sound").onclick = () => { setDeviceSound(!deviceSound()); renderSound(); };
renderSound();

// ---- Account ---------------------------------------------------------------------------
function renderAccount(user) {
  $("account").textContent = user ? ` ${user.username}` : "Log in";
  if (user) $("account").insertAdjacentHTML("afterbegin", icon("user"));
  $("account").title = user ? "Account" : "Log in or create an account";
}
api.onAuthChange(renderAccount);
$("account").onclick = () => {
  const user = api.currentUser();
  if (!user) { openAuth(); return; }
  $("userName").textContent = user.username;
  $("userDlg").showModal();
};
$("userClose").onclick = () => $("userDlg").close();
$("logout").onclick = async () => {
  $("userDlg").close();
  await api.logout();
  toast("Logged out");
};

// ---- Start ---------------------------------------------------------------------------
initAuthDialog();
initStudio();
renderAccount(api.currentUser()); // remembered in this browser; checked again when the ESP32 connects
let start = location.hash.slice(1);
if (!start) try { start = localStorage.getItem("piano-mode"); } catch {}
setMode(start || "piano");
