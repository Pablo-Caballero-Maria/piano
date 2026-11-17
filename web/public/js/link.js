// The live class link. In the classroom: a WebSocket to the teacher's PC (fog/classroom.py).
// Online: Ably channels, one per teacher's lesson (pianocore/ably.py). The rest of the page uses
// the same calls and receives the same messages {t: type, …} either way:
//   welcome, lesson {live, mode}, teacher.note {freq, midi}, teacher.studio {melody, playhead,
//   playing}, buzzer {holder, live, granted, queue}, board {online, version}, people {people},
//   lessons {teachers} (online), error {message}, status {state, text}.
import * as api from "./api.js";

const ABLY_SDK = "https://cdn.ably.com/lib/ably.min-2.js";
const handlers = new Map();
let transport = null;
let mode = null; // "classroom" | "online" | null

/** Call fn(msg) for every message of type t. */
export function on(t, fn) {
  if (!handlers.has(t)) handlers.set(t, new Set());
  handlers.get(t).add(fn);
}

function emit(msg) {
  for (const fn of handlers.get(msg.t) || []) {
    try { fn(msg); } catch (e) { console.error(e); }
  }
}

const status = (state, text) => emit({ t: "status", state, text });

/** "classroom", "online" or null (not connected). */
export const where = () => mode;
export const connected = () => !!transport?.open;

/** Connect (needs a login); call again after logging in or out. */
export async function start() {
  stop();
  const cfg = await api.config();
  if (!api.token()) {
    status("off", cfg.mode === "classroom" ? "Log in to join the class" : "Not in a lesson");
    return;
  }
  mode = cfg.realtime === "ws" ? "classroom" : cfg.realtime === "ably" ? "online" : null;
  if (mode === "classroom") transport = new Classroom();
  else if (mode === "online") transport = new Online();
  else status("off", "Offline");
}

export function stop() {
  transport?.close();
  transport = null;
  mode = null;
}

// What the page reports; the transport decides where it goes
export const note = (freq, midi) => transport?.note(freq, midi);
export const activity = (a) => transport?.activity(a);
export const live = (on, lessonMode) => transport?.live(on, lessonMode);
export const studio = (state) => transport?.studio(state);
export const queue = (action, args = {}) => transport?.queue?.(action, args);
export const follow = (teacher) => transport?.follow?.(teacher);
export const lessons = () => transport?.lessons?.();

// ---- Classroom: WebSocket to the teacher's PC ------------------------------------------
class Classroom {
  constructor() {
    this.closed = false;
    this.open = false;
    this.retry = 1000;
    this.last = { mode: "piano" };
    this.connect();
  }

  connect() {
    status("connecting", "Joining the class…");
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: "hello", token: api.token(), mode: this.last.mode }));
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === "welcome") {
        this.open = true;
        this.retry = 1000;
        status("on", "In class");
      }
      emit(msg);
    };
    ws.onclose = (e) => {
      this.open = false;
      if (this.closed) return;
      if (e.code === 4401) { status("off", "Log in to join the class"); return; }
      status("connecting", "Lost the class, reconnecting…");
      setTimeout(() => !this.closed && this.connect(), this.retry);
      this.retry = Math.min(this.retry * 2, 15000);
    };
  }

  send(msg) {
    if (this.open && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.closed = true;
    this.ws?.close();
    status("off", "Not in class");
  }

  note(freq, midi) { this.send({ t: "note", freq, midi }); }
  activity(a) { this.last = { ...this.last, ...a }; this.send({ t: "activity", ...a }); }
  live(on, m) { this.send({ t: "live", on, mode: m }); }
  studio(state) { this.send({ t: "studio", ...state }); }
  queue(action, args) { this.send({ t: `queue.${action}`, ...args }); }
}

// ---- Online: Ably ---------------------------------------------------------------------
let sdk = null;
function loadAbly() {
  sdk ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = ABLY_SDK;
    s.onload = () => resolve(window.Ably);
    s.onerror = () => reject(new Error("Couldn't load Ably"));
    document.head.append(s);
  });
  return sdk;
}

class Online {
  constructor() {
    this.open = false;
    this.closed = false;
    this.following = null; // the lesson channel I follow (students)
    this.own = null; // my own lesson channel (teachers, while live)
    this.liveOn = false;
    this.presence = { mode: "piano", notes: [], detail: "" };
    this.presenceTimer = 0;
    this.start().catch((e) => status("off", `Live lessons unavailable: ${e.message}`));
  }

  async start() {
    status("connecting", "Connecting…");
    const Ably = await loadAbly();
    if (this.closed) return;
    this.client = new Ably.Realtime({
      authCallback: (params, cb) => api.post("/ably/token").then((tr) => cb(null, tr), (e) => cb(e.message, null)),
    });
    this.client.connection.on("connected", () => { this.open = true; status("on", "Online"); this.lessons(); });
    this.client.connection.on("disconnected", () => { this.open = false; status("connecting", "Reconnecting…"); });
    this.client.connection.on("failed", () => { this.open = false; status("off", "Live lessons unavailable"); });
  }

  close() {
    this.closed = true;
    try { this.client?.close(); } catch {}
    status("off", "Not in a lesson");
  }

  channel(teacher) { return this.client.channels.get(`class:${teacher.toLowerCase()}`); }

  async lessons() {
    try { emit({ t: "lessons", teachers: (await api.get("/live")).teachers }); } catch {}
  }

  /** Follow teacher's lesson (null: stop following). */
  async follow(teacher) {
    if (this.following) {
      const ch = this.following;
      this.following = null;
      ch.unsubscribe();
      ch.presence.leave().catch(() => {});
      emit({ t: "lesson", live: null, mode: "piano" });
    }
    if (!teacher) return;
    const ch = this.channel(teacher);
    this.following = ch;
    ch.subscribe((m) => {
      const d = m.data || {};
      if (m.name === "lesson") emit({ t: "lesson", live: d.live ? teacher : null, mode: d.mode || "piano" });
      else if (m.name === "note") emit({ t: "teacher.note", freq: d.freq, midi: d.midi || [] });
      else if (m.name === "studio") emit({ t: "teacher.studio", ...d });
    });
    await ch.presence.enter(this.presence);
    emit({ t: "lesson", live: teacher, mode: "piano" });
  }

  activity(a) {
    this.presence = { ...this.presence, ...a };
    clearTimeout(this.presenceTimer); // Ably limits presence updates: send the latest every 0.5 s
    this.presenceTimer = setTimeout(() => this.following?.presence.update(this.presence).catch(() => {}), 500);
  }

  async live(on, m) {
    const me = api.currentUser()?.username;
    if (!me || !api.isTeacher()) return;
    this.own ??= this.channel(me);
    this.liveOn = on;
    await this.own.publish("lesson", { live: on, mode: m });
    if (on) {
      const refresh = async () => {
        const members = await this.own.presence.get();
        emit({ t: "people", people: members.filter((p) => p.clientId !== me).map((p) => ({
          id: `ably:${p.clientId}`, name: p.clientId, role: "student", remote: true, ...(p.data || {}),
        })) });
      };
      this.own.presence.subscribe(refresh);
      refresh();
    } else {
      this.own.presence.unsubscribe();
    }
    emit({ t: "lesson", live: on ? me : null, mode: m });
  }

  note(freq, midi) {
    if (this.liveOn) this.own?.publish("note", { freq, midi }).catch(() => {});
    else this.activity({ notes: midi }); // a student: the teacher sees it in my presence
  }

  studio(state) {
    if (this.liveOn) this.own?.publish("studio", state).catch(() => {});
  }
}
