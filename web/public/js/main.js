// Page wiring: the header (class status, device sound, class, account), the Piano / Studio
// modes, the computer keyboard, and what the page tells the class (link.js, class.js): my mode
// and activity, the live teacher's piano roll, following the teacher's lesson.
import * as api from "./api.js";
import * as classUI from "./class.js";
import { Keyboard } from "./keyboard.js";
import * as link from "./link.js";
import { freqOf, noteName } from "./notes.js";
import { deviceSound, output, setDeviceSound, unlockAudio } from "./sound.js";
import {
  followTeacher, initStudio, onStudioChange, panic, setStudioActive, setTeacherNotes, studioDetail,
  studioKeyDown, studioKeyUp, studioState,
} from "./studio.js";
import { icon, initAuthDialog, openAuth, toast } from "./ui.js";

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
  output(f, m ? [m] : []);
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
  reportActivity();
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

// ---- The class --------------------------------------------------------------------------
let activityTimer = 0;
/** Tell the class what I'm doing (the teacher's list); at most every 300 ms. */
function reportActivity() {
  clearTimeout(activityTimer);
  activityTimer = setTimeout(() => link.activity({ mode, detail: mode === "studio" ? studioDetail() : "" }), 300);
}

let rollTimer = 0;
/** A live teacher in a studio lesson shares the piano roll: playback at once, edits batched. */
function shareRoll(kind) {
  if (!classUI.amLive() || classUI.lesson().mode !== "studio") return;
  clearTimeout(rollTimer);
  rollTimer = setTimeout(() => link.studio(studioState()), kind === "edit" ? 250 : 0);
}
onStudioChange((kind) => {
  shareRoll(kind);
  reportActivity();
});

let lastLesson = "";
classUI.init({
  currentMode: () => mode,
  teacherNotes: (midi) => {
    pianoKb.setTeacher(midi);
    setTeacherNotes(midi);
  },
  teacherStudio: (st) => {
    if (classUI.amLive()) return;
    followTeacher(st ? { ...st, teacher: classUI.lesson().live } : null);
  },
});
classUI.onChange(() => {
  renderStatus();
  const l = classUI.lesson();
  const key = l.live ? `${l.live}/${l.mode}` : "";
  if (key !== lastLesson) {
    lastLesson = key;
    if (classUI.watchingLesson() && l.mode !== mode) setMode(l.mode); // students see the lesson's mode
    if (classUI.amLive()) shareRoll("transport"); // the roll, right away, for everyone
  }
});

function renderStatus() {
  const s = classUI.status();
  const board = classUI.board();
  let text = s.text || "Not connected";
  if (s.state === "on" && link.where() === "classroom" && board) {
    text += board.online ? " · board online" : " · board offline";
  }
  $("status").dataset.state = s.state === "on" ? "connected" : s.state === "connecting" ? "connecting" : "idle";
  $("statusText").textContent = text;
}

if (!window.isSecureContext) {
  const n = $("notice");
  n.hidden = false;
  n.textContent = "Open this page over https:// (accounts and the class need a secure page).";
}

// ---- Device sound -----------------------------------------------------------------------
function renderSound() {
  const on = deviceSound();
  $("sound").setAttribute("aria-pressed", on);
  $("sound").innerHTML = icon(on ? "vol" : "mute");
  $("sound").title = on ? "Device sound on: notes play on this phone/PC" : "Device sound off: silent here (the buzzer still plays if it's your turn)";
}
$("sound").onclick = () => { setDeviceSound(!deviceSound()); renderSound(); };
renderSound();

// ---- Account ---------------------------------------------------------------------------
function renderAccount(user) {
  $("account").textContent = user ? ` ${user.username}` : "Log in";
  if (user) $("account").insertAdjacentHTML("afterbegin", icon("user"));
  $("account").title = user ? `Account (${user.role})` : "Log in or create an account";
}
api.onAuthChange((user) => {
  renderAccount(user);
  link.start(); // join the class (or leave it) with the new account
});
$("account").onclick = () => {
  const user = api.currentUser();
  if (!user) { openAuth(); return; }
  $("userName").textContent = user.username;
  $("userRole").textContent = user.role === "teacher"
    ? "Teacher: you can give lessons, see your students and manage the buzzer."
    : "Student: you can follow lessons and ask for the buzzer.";
  $("userDlg").showModal();
};
$("userClose").onclick = () => $("userDlg").close();
$("logout").onclick = () => {
  $("userDlg").close();
  api.logout();
  toast("Logged out");
};

// ---- Start ---------------------------------------------------------------------------
initAuthDialog();
initStudio();
renderAccount(api.currentUser()); // remembered in this browser
renderStatus();
let start = location.hash.slice(1);
if (!start) try { start = localStorage.getItem("piano-mode"); } catch {}
setMode(start || "piano");
link.start();
