"use client";

/**
 * The class panel. Teachers: start/end the lesson, everyone in class and what each one is doing
 * (handing the buzzer to a student during the lesson), the buzzer queue, and the classroom PC.
 * Students: the buzzer queue (in the classroom) or the live lessons to follow (online).
 */
import { useEffect, useState } from "react";
import { Modal, ModalHeader } from "@/components/dialogs/Modal";
import { X } from "lucide-react";
import { button, DIALOG_ROW_START, ICON, MUTED_P } from "@/components/ui/classes";
import { useStore } from "@/hooks/useStore";
import { noteNames } from "@/lib/notes";
import { api, classState } from "@/services";
import type { PcStatus } from "@/services/api";
import type { Mode, Person } from "@/services/link/messages";
import { isLive, queuePosition, type ClassSnapshot } from "@/state/class-state";
import { toast } from "@/state/toast";

const HEADING = "mb-1.5 text-[14px] font-bold tracking-[0.04em] text-muted uppercase";
/** A list of names with a button or two each. */
const LIST = "mt-1.5 flex flex-col gap-1.5";
const LIST_ITEM = "flex items-center gap-1.5 rounded-[10px] border border-line bg-[#191c21] px-2.5 py-1.5";

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
      <div className="min-h-0 flex-1 overflow-auto [&_section+section]:mt-[18px]">
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
      <h3 className={HEADING}>Lesson</h3>
      <p className={MUTED_P}>
        {live
          ? `Everyone sees what you play${cls.lesson.mode === "studio" ? " and your piano roll" : ""}.`
          : `Students see what you play in ${mode} mode (switch mode first to change it).`}
      </p>
      <div className={DIALOG_ROW_START}>
        <button
          type="button"
          className={button(live ? "primaryDanger" : "primary")}
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
      <h3 className={HEADING}>Live lessons</h3>
      <ul className={LIST}>
        {cls.teachers.map((t) => {
          const following = cls.following === t;
          return (
            <li key={t} className={LIST_ITEM}>
              <span className="min-w-0 flex-1 truncate">{t}</span>
              <button
                type="button"
                className={button(following ? "plain" : "primary", "listItem")}
                title={following ? "Stop following" : "Follow this lesson"}
                onClick={() => void classState.follow(following ? null : t)}
              >
                {following ? "Leave" : "Join"}
              </button>
            </li>
          );
        })}
      </ul>
      {cls.teachers.length ? null : <p className={MUTED_P}>No lesson is live right now.</p>}
      <div className={DIALOG_ROW_START}>
        <button type="button" className={button()} onClick={() => classState.refreshLessons()}>
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
      <h3 className={HEADING}>Buzzer</h3>
      <p className={MUTED_P}>{now}</p>
      <ul className={LIST}>
        {b.queue.map((name, i) => (
          <li key={name} className={LIST_ITEM}>
            <span className="min-w-0 flex-1 truncate">
              {i + 1}. {name}
              {name === me ? " (you)" : ""}
            </span>
            {teacher && i > 0 ? (
              <button
                type="button"
                className={button("plain", "listItem")}
                title="Move up"
                onClick={() => classState.queue("move", { user: name, to: i - 1 })}
              >
                ↑
              </button>
            ) : null}
            {teacher ? (
              <button
                type="button"
                className={button("plain", "listItem")}
                title="Remove from the queue"
                aria-label={`Remove ${name} from the queue`}
                onClick={() => classState.queue("remove", { user: name })}
              >
                <X className={ICON} />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {b.queue.length ? null : <p className={MUTED_P}>Nobody is waiting.</p>}
      <div className={DIALOG_ROW_START}>
        {teacher && live ? null : (
          <button
            type="button"
            className={button("primary")}
            onClick={() => classState.toggleBuzzerRequest()}
          >
            {askLabel}
          </button>
        )}
        {teacher && b.queue.length && !b.live ? (
          <button type="button" className={button()} onClick={() => classState.queue("next")}>
            Next
          </button>
        ) : null}
        {teacher && live && b.granted ? (
          <button type="button" className={button()} onClick={() => classState.queue("revoke")}>
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
      <h3 className={HEADING}>In class</h3>
      <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto">
        {others.map((p) => {
          const has = cls.buzzer.granted === p.name;
          return (
            <li
              key={p.id}
              className="flex items-center gap-1.5 rounded-[10px] border border-line bg-[#191c21] px-2.5 py-2"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <b className="truncate">
                  {p.name}
                  {p.role === "teacher" ? " (teacher)" : ""}
                  {p.remote ? " · from home" : ""}
                </b>
                <small className="text-[12px] text-muted">{describe(p)}</small>
              </div>
              {canHand && !p.remote && p.role !== "teacher" ? (
                <button
                  type="button"
                  className={button(has ? "plain" : "primary", "row")}
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
      {others.length ? null : <p className={MUTED_P}>Nobody else is connected.</p>}
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
      <h3 className={HEADING}>Classroom PC</h3>
      <pre className="rounded-lg border border-line bg-[#191c21] px-2.5 py-2 text-[12px] whitespace-pre-wrap text-muted select-text">
        {text}
      </pre>
      <div className={DIALOG_ROW_START}>
        <button type="button" className={button()} onClick={() => void checkForUpdates()}>
          Check for updates
        </button>
      </div>
    </section>
  );
}
