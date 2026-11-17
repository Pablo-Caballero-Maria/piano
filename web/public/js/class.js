// The class, on the page: the live lesson, the buzzer queue and, for teachers, who is here and
// what each one is doing. Messages come from link.js (the teacher's PC in the classroom, Ably
// online); this module keeps the state and draws the class bar and the class dialog.
import * as api from "./api.js";
import * as link from "./link.js";
import { noteName } from "./notes.js";
import { toast, icon } from "./ui.js";

const $ = (id) => document.getElementById(id);
const state = {
  status: { state: "off", text: "" },
  lesson: { live: null, mode: "piano" },
  buzzer: { holder: null, live: null, granted: null, queue: [] },
  board: null,
  people: [],
  teachers: [], // online: lessons happening now
  following: null, // online: the teacher whose lesson I follow
  teacherNotes: [],
};
const listeners = new Set();
let hooks = {};

const me = () => api.currentUser()?.username ?? null;
const names = (midi) => (midi || []).map(noteName).join(" ");

/** fn() after any change of the class state. */
export const onChange = (fn) => listeners.add(fn);
export const status = () => state.status;
export const lesson = () => state.lesson;
export const board = () => state.board;
/** True if I'm the teacher giving the lesson right now. */
export const amLive = () => !!state.lesson.live && state.lesson.live === me();
/** True if a lesson by someone else is on (and I'm in it). */
export const watchingLesson = () => !!state.lesson.live && state.lesson.live !== me();

function changed() {
  render();
  for (const fn of listeners) fn();
}

/**
 * hooks: teacherNotes(midi) shows what the live teacher plays; teacherStudio(state | null)
 * follows the teacher's piano roll; currentMode() is "piano" or "studio".
 */
export function init(h) {
  hooks = h;
  link.on("status", (m) => { state.status = m; changed(); });
  link.on("welcome", (m) => {
    state.lesson = { live: m.lesson.live, mode: m.lesson.mode };
    state.buzzer = m.buzzer;
    state.board = m.board;
    if (m.people) state.people = m.people;
    if (m.studio) hooks.teacherStudio(m.studio);
    link.activity({ mode: hooks.currentMode() });
    changed();
  });
  link.on("lesson", (m) => {
    const wasLive = state.lesson.live;
    state.lesson = { live: m.live, mode: m.mode };
    if (!m.live || m.mode !== "studio") hooks.teacherStudio(null);
    if (!m.live) setTeacherNotes([]);
    if (m.live && m.live !== wasLive && m.live !== me()) toast(`${m.live} started the lesson`);
    changed();
  });
  link.on("teacher.note", (m) => setTeacherNotes(m.midi));
  link.on("teacher.studio", (m) => hooks.teacherStudio(m));
  link.on("buzzer", (m) => {
    const had = state.buzzer.holder === me();
    state.buzzer = m;
    if (!had && m.holder === me() && me() && m.live !== me()) toast("Your turn: you're playing on the buzzer");
    changed();
  });
  link.on("board", (m) => { state.board = m; changed(); });
  link.on("people", (m) => { state.people = m.people; renderPeople(); });
  link.on("lessons", (m) => { state.teachers = m.teachers; renderLessons(); });
  link.on("error", (m) => toast(m.message, "error"));
  initDialog();
  render();
}

function setTeacherNotes(midi) {
  state.teacherNotes = midi || [];
  hooks.teacherNotes(state.teacherNotes);
  const el = $("classNotes");
  el.textContent = state.teacherNotes.length ? names(state.teacherNotes) : "";
}

// ---- Actions ---------------------------------------------------------------------------
/** Start (or end) my lesson, in the mode I'm using. */
export function toggleLive() {
  if (amLive()) link.live(false, state.lesson.mode);
  else link.live(true, hooks.currentMode());
}

function queuePosition() {
  return state.buzzer.queue.indexOf(me());
}

// ---- The class bar under the header --------------------------------------------------------
function render() {
  const inClass = state.status.state === "on";
  const bar = $("classBar");
  const parts = [];
  if (amLive()) parts.push(`You're giving the lesson (${state.lesson.mode})`);
  else if (state.lesson.live) parts.push(`${state.lesson.live} is giving a ${state.lesson.mode} lesson`);
  const holder = state.buzzer.holder;
  if (link.where() === "classroom" && holder === me()) parts.push("you're playing on the buzzer");
  else if (link.where() === "classroom" && queuePosition() > 0) parts.push(`you're #${queuePosition() + 1} for the buzzer`);
  bar.hidden = !inClass || !parts.length;
  $("classText").textContent = parts.join(" · ");
  bar.classList.toggle("live", !!state.lesson.live);
  const btn = $("classBtn");
  btn.classList.toggle("live", !!state.lesson.live);
  btn.disabled = !inClass && link.where() !== "online";
  if ($("classDlg").open) renderDialog();
}

// ---- The class dialog ------------------------------------------------------------------------
function initDialog() {
  $("classBtn").onclick = () => {
    $("classDlg").showModal(); // first: the lists only draw themselves into an open dialog
    renderDialog();
    if (link.where() === "online") link.lessons();
    if (api.isTeacher() && link.where() === "classroom") refreshPC();
  };
  $("classClose").onclick = () => $("classDlg").close();
  $("lessonToggle").onclick = toggleLive;
  $("buzzerAsk").onclick = () => link.queue(queuePosition() >= 0 ? "leave" : "join");
  $("buzzerNext").onclick = () => link.queue("next");
  $("buzzerRevoke").onclick = () => link.queue("revoke");
  $("pcUpdate").onclick = async () => {
    try {
      await api.post("/update");
      toast("Checking GitHub for a new version…");
      setTimeout(refreshPC, 3000);
    } catch (err) { toast(err.message, "error"); }
  };
  $("lessonsRefresh").onclick = () => link.lessons();
}

function renderDialog() {
  const teacher = api.isTeacher();
  const classroom = link.where() === "classroom";
  $("lessonSection").hidden = !teacher;
  $("lessonToggle").textContent = amLive() ? "End the lesson" : "Start the lesson";
  $("lessonToggle").classList.toggle("danger", amLive());
  $("lessonHelp").textContent = amLive()
    ? `Everyone sees what you play${state.lesson.mode === "studio" ? " and your piano roll" : ""}.`
    : `Students see what you play in ${hooks.currentMode()} mode (switch mode first to change it).`;
  $("lessonsSection").hidden = classroom || teacher;
  $("buzzerSection").hidden = !classroom;
  $("peopleSection").hidden = !teacher;
  $("pcSection").hidden = !(teacher && classroom);
  renderBuzzer();
  renderPeople();
  renderLessons();
}

function rowButton(label, title, fn, cls = "") {
  const b = document.createElement("button");
  b.type = "button";
  b.innerHTML = label; // icon() markup or fixed text only
  b.title = title;
  b.className = cls;
  b.onclick = fn;
  return b;
}

function renderBuzzer() {
  const b = state.buzzer;
  const teacher = api.isTeacher();
  $("buzzerNow").textContent = b.holder
    ? `Playing on the buzzer: ${b.holder}${b.granted ? " (handed over by " + b.live + ")" : b.live ? " (the lesson)" : ""}`
    : "Nobody is playing on the buzzer.";
  const pos = queuePosition();
  $("buzzerAsk").textContent = pos === 0 && !b.live ? "Give up the buzzer" : pos > 0 ? "Leave the queue" : "Ask for the buzzer";
  $("buzzerAsk").hidden = teacher && amLive();
  $("buzzerNext").hidden = !teacher || !b.queue.length || !!b.live;
  $("buzzerRevoke").hidden = !(teacher && amLive() && b.granted);
  const ul = $("buzzerQueue");
  ul.innerHTML = "";
  b.queue.forEach((name, i) => {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.className = "name";
    label.textContent = `${i + 1}. ${name}${name === me() ? " (you)" : ""}`;
    li.append(label);
    if (teacher) {
      if (i > 0) li.append(rowButton("↑", "Move up", () => link.queue("move", { user: name, to: i - 1 })));
      li.append(rowButton(icon("x"), "Remove from the queue", () => link.queue("remove", { user: name })));
    }
    ul.append(li);
  });
  $("buzzerEmpty").hidden = b.queue.length > 0;
}

function renderPeople() {
  if (!$("classDlg").open || !api.isTeacher()) return;
  const ul = $("peopleList");
  ul.innerHTML = "";
  const others = state.people.filter((p) => p.name !== me());
  $("peopleEmpty").hidden = others.length > 0;
  for (const p of others) {
    const li = document.createElement("li");
    const info = document.createElement("div");
    info.className = "info";
    const b = document.createElement("b");
    b.textContent = p.name + (p.role === "teacher" ? " (teacher)" : "") + (p.remote ? " · from home" : "");
    const small = document.createElement("small");
    const playing = names(p.notes);
    small.textContent = [p.mode === "studio" ? "Studio" : "Piano", playing && `playing ${playing}`, p.detail]
      .filter(Boolean).join(" · ");
    info.append(b, small);
    li.append(info);
    if (amLive() && !p.remote && p.role !== "teacher" && link.where() === "classroom") {
      const has = state.buzzer.granted === p.name;
      li.append(rowButton(has ? "Take back" : "Give buzzer", "Let this student play on the buzzer",
        () => link.queue(has ? "revoke" : "grant", { user: p.name }), has ? "" : "primary"));
    }
    ul.append(li);
  }
}

function renderLessons() {
  if (!$("classDlg").open || link.where() !== "online") return;
  const ul = $("lessonsList");
  ul.innerHTML = "";
  $("lessonsEmpty").hidden = state.teachers.length > 0;
  for (const t of state.teachers) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = t;
    const following = state.following === t;
    li.append(name, rowButton(following ? "Leave" : "Join", following ? "Stop following" : "Follow this lesson", async () => {
      state.following = following ? null : t;
      await link.follow(state.following);
      renderLessons();
    }, following ? "" : "primary"));
    ul.append(li);
  }
}

async function refreshPC() {
  try {
    const s = await api.get("/status");
    const lines = [
      `Board: ${s.board.online ? `online (version ${s.board.version || "?"})` : "offline"}`,
      `Internet: ${s.internet ? "yes" : "no"}`,
      `Sync with the cloud: ${s.sync ? s.sync.result : "not yet"}`,
      `Software: version ${s.update.version}${s.update.result ? " · " + s.update.result : ""}`,
    ];
    $("pcStatus").textContent = lines.join("\n");
  } catch (err) {
    $("pcStatus").textContent = err.message;
  }
}
