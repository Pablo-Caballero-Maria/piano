"use client";

/**
 * The class panel. Teachers: start/end the lesson, everyone in class and what each one is doing
 * (handing the buzzer to a student during the lesson), the buzzer queue, and the classroom PC.
 * Students: the buzzer queue (in the classroom) or the live lessons to follow (online).
 */
import { useEffect, useState } from "react";
import { Modal, ModalHeader } from "@/components/dialogs/Modal";
import { Icon } from "@/components/ui/Icon";
import { useStore } from "@/hooks/useStore";
import { noteNames } from "@/lib/notes";
import { api, classState } from "@/services";
import type { PcStatus } from "@/services/api";
import type { Mode, Person } from "@/services/link/messages";
import { isLive, queuePosition, type ClassSnapshot } from "@/state/class-state";
import { toast } from "@/state/toast";

export interface ClassDialogProps {
  open: boolean;
  onClose: () => void;
  /** The mode I'm in (a lesson starts in it). */
  mode: Mode;
}

export function ClassDialog({ open, onClose, mode }: ClassDialogProps) {
  const cls = useStore(classState.store);
  const user = useStore(api.session, null)?.user ?? null;
  const me = user?.username ?? null;
  const teacher = user?.role === "teacher";
  const classroom = cls.where === "classroom";

  // When it opens: the lessons live now (online), the PC's status (teachers in the classroom)
  useEffect(() => {
    if (open && cls.where === "online") classState.refreshLessons();
  }, [open, cls.where]);

  return (
    <Modal open={open} onClose={onClose} wide label="Class">
      <ModalHeader title="Class" onClose={onClose} />
      <div className="dlg-body">
        {teacher ? <LessonSection cls={cls} me={me} mode={mode} /> : null}
        {!classroom && !teacher ? <LiveLessonsSection cls={cls} /> : null}
        {classroom ? <BuzzerSection cls={cls} me={me} teacher={teacher} /> : null}
        {teacher ? <PeopleSection cls={cls} me={me} /> : null}
        {teacher && classroom && open ? <PcSection /> : null}
      </div>
    </Modal>
  );
}

function LessonSection({ cls, me, mode }: { cls: ClassSnapshot; me: string | null; mode: Mode }) {
  const live = isLive(cls, me);
  return (
    <section>
      <h3>Lesson</h3>
      <p className="muted">
        {live
          ? `Everyone sees what you play${cls.lesson.mode === "studio" ? " and your piano roll" : ""}.`
          : `Students see what you play in ${mode} mode (switch mode first to change it).`}
      </p>
      <div className="row start">
        <button
          type="button"
          className={live ? "primary danger" : "primary"}
          onClick={() => classState.toggleLive(mode)}
        >
          {live ? "End the lesson" : "Start the lesson"}
        </button>
      </div>
    </section>
  );
}

function LiveLessonsSection({ cls }: { cls: ClassSnapshot }) {
  return (
    <section>
      <h3>Live lessons</h3>
      <ul className="plain-list">
        {cls.teachers.map((t) => {
          const following = cls.following === t;
          return (
            <li key={t}>
              <span className="name">{t}</span>
              <button
                type="button"
                className={following ? "" : "primary"}
                title={following ? "Stop following" : "Follow this lesson"}
                onClick={() => void classState.follow(following ? null : t)}
              >
                {following ? "Leave" : "Join"}
              </button>
            </li>
          );
        })}
      </ul>
      {cls.teachers.length ? null : <p className="muted">No lesson is live right now.</p>}
      <div className="row start">
        <button type="button" onClick={() => classState.refreshLessons()}>
          Refresh
        </button>
      </div>
    </section>
  );
}

function BuzzerSection({ cls, me, teacher }: { cls: ClassSnapshot; me: string | null; teacher: boolean }) {
  const b = cls.buzzer;
  const live = isLive(cls, me);
  const pos = queuePosition(cls, me);
  let now = "Nobody is playing on the buzzer.";
  if (b.holder) {
    const how = b.granted ? ` (handed over by ${b.live})` : b.live ? " (the lesson)" : "";
    now = `Playing on the buzzer: ${b.holder}${how}`;
  }
  const askLabel =
    pos === 0 && !b.live ? "Give up the buzzer" : pos > 0 ? "Leave the queue" : "Ask for the buzzer";
  return (
    <section>
      <h3>Buzzer</h3>
      <p className="muted">{now}</p>
      <ul className="plain-list">
        {b.queue.map((name, i) => (
          <li key={name}>
            <span className="name">
              {i + 1}. {name}
              {name === me ? " (you)" : ""}
            </span>
            {teacher && i > 0 ? (
              <button
                type="button"
                title="Move up"
                onClick={() => classState.queue("move", { user: name, to: i - 1 })}
              >
                ↑
              </button>
            ) : null}
            {teacher ? (
              <button
                type="button"
                title="Remove from the queue"
                aria-label={`Remove ${name} from the queue`}
                onClick={() => classState.queue("remove", { user: name })}
              >
                <Icon name="x" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {b.queue.length ? null : <p className="muted">Nobody is waiting.</p>}
      <div className="row start">
        {teacher && live ? null : (
          <button type="button" className="primary" onClick={() => classState.toggleBuzzerRequest()}>
            {askLabel}
          </button>
        )}
        {teacher && b.queue.length && !b.live ? (
          <button type="button" onClick={() => classState.queue("next")}>
            Next
          </button>
        ) : null}
        {teacher && live && b.granted ? (
          <button type="button" onClick={() => classState.queue("revoke")}>
            Take the buzzer back
          </button>
        ) : null}
      </div>
    </section>
  );
}

function describe(p: Person): string {
  const playing = noteNames(p.notes ?? []);
  return [p.mode === "studio" ? "Studio" : "Piano", playing && `playing ${playing}`, p.detail]
    .filter(Boolean)
    .join(" · ");
}

function PeopleSection({ cls, me }: { cls: ClassSnapshot; me: string | null }) {
  const others = cls.people.filter((p) => p.name !== me);
  const canHand = isLive(cls, me) && cls.where === "classroom";
  return (
    <section>
      <h3>In class</h3>
      <ul className="melody-list">
        {others.map((p) => {
          const has = cls.buzzer.granted === p.name;
          return (
            <li key={p.id}>
              <div className="info">
                <b>
                  {p.name}
                  {p.role === "teacher" ? " (teacher)" : ""}
                  {p.remote ? " · from home" : ""}
                </b>
                <small>{describe(p)}</small>
              </div>
              {canHand && !p.remote && p.role !== "teacher" ? (
                <button
                  type="button"
                  className={has ? "" : "primary"}
                  title="Let this student play on the buzzer"
                  onClick={() => classState.queue(has ? "revoke" : "grant", { user: p.name })}
                >
                  {has ? "Take back" : "Give buzzer"}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {others.length ? null : <p className="muted">Nobody else is connected.</p>}
    </section>
  );
}

function pcStatusText(s: PcStatus): string {
  return [
    `Board: ${s.board.online ? `online (version ${s.board.version || "?"})` : "offline"}`,
    `Internet: ${s.internet ? "yes" : "no"}`,
    `Sync with the cloud: ${s.sync ? s.sync.result : "not yet"}`,
    `Software: version ${s.update.version}${s.update.result ? ` · ${s.update.result}` : ""}`,
  ].join("\n");
}

/** The classroom PC: board, internet, cloud sync and software version; check for updates. */
function PcSection() {
  const [text, setText] = useState("…");
  const [refreshes, setRefreshes] = useState(0);

  useEffect(() => {
    let current = true;
    api.pcStatus().then(
      (s) => current && setText(pcStatusText(s)),
      (e: Error) => current && setText(e.message),
    );
    return () => {
      current = false;
    };
  }, [refreshes]);

  const checkForUpdates = async () => {
    try {
      await api.checkForUpdates();
      toast("Checking GitHub for a new version…");
      setTimeout(() => setRefreshes((n) => n + 1), 3000);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  return (
    <section>
      <h3>Classroom PC</h3>
      <pre className="pc-status">{text}</pre>
      <div className="row start">
        <button type="button" onClick={() => void checkForUpdates()}>
          Check for updates
        </button>
      </div>
    </section>
  );
}
