"use client";

/** "Melodies": mine and everyone's public ones, to open, play, copy or delete. */
import { useEffect, useRef, useState } from "react";
import { Modal, ModalHeader } from "@/components/dialogs/Modal";
import { BUTTON, MUTED, MUTED_P, SEGMENTED } from "@/components/ui/classes";
import { Icon } from "@/components/ui/Icon";
import { useStore } from "@/hooks/useStore";
import { formatTime, plural, timeAgo } from "@/lib/format";
import type { MelodySummary } from "@/lib/melody";
import { api } from "@/services";
import type { MelodyLibrary, Scope } from "@/studio/library";

export interface MelodiesDialogProps {
  open: boolean;
  onClose: () => void;
  library: MelodyLibrary;
  /** The melody open in the studio (highlighted). */
  currentId: string | null;
}

type ListState =
  { status: "loading" } | { status: "error"; message: string } | { status: "ready"; items: MelodySummary[] };

/** A row of the list, and its buttons. */
const ROW = "flex items-center gap-1.5 rounded-[10px] px-2.5 py-2";
const ROW_BUTTON = "flex-none px-2.5 py-[7px]";

const EMPTY: Record<Scope, string> = {
  mine: "No melodies yet. Compose one in the Studio and press Save.",
  public: "No public melodies yet. Make one of yours public with the lock button next to Save.",
};

const WHERE: Record<string, string> = {
  classroom: "Kept on the classroom board, and in the cloud when it syncs.",
  online: "Kept in the cloud.",
};

export function MelodiesDialog({ open, onClose, library, currentId }: MelodiesDialogProps) {
  const [scope, setScope] = useState<Scope>("mine");
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [where, setWhere] = useState("");
  const [version, setVersion] = useState(0); // bumped to reload the list
  const session = useStore(api.session, null);

  useEffect(() => library.changed.on(() => setVersion((v) => v + 1)), [library]);

  useEffect(() => {
    if (!open) return;
    let current = true;
    library.list(scope).then(
      (items) => current && setList({ status: "ready", items }),
      (e: Error) => current && setList({ status: "error", message: e.message }),
    );
    void api.config().then((cfg) => current && setWhere(WHERE[cfg.mode] ?? ""));
    return () => {
      current = false;
    };
  }, [open, scope, version, session, library]);

  const chooseScope = (s: Scope) => {
    setScope(s);
    setList({ status: "loading" });
  };

  const openMelody = async (id: string, play: boolean) => {
    if (await library.open(id, play)) onClose();
  };

  const me = session?.user.username ?? null;
  return (
    <Modal open={open} onClose={onClose} wide label="Melodies">
      <ModalHeader title="Melodies" onClose={onClose} />
      <div className={`${SEGMENTED.group} mb-2.5`}>
        <button
          type="button"
          className={SEGMENTED.button}
          aria-pressed={scope === "mine"}
          onClick={() => chooseScope("mine")}
        >
          Mine
        </button>
        <button
          type="button"
          className={SEGMENTED.button}
          aria-pressed={scope === "public"}
          onClick={() => chooseScope("public")}
        >
          <Icon name="globe" /> Public
        </button>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto">
        {list.status === "loading" ? <li className={`${ROW} ${MUTED}`}>Loading…</li> : null}
        {list.status === "error" ? <li className={`${ROW} ${MUTED}`}>{list.message}</li> : null}
        {list.status === "ready"
          ? list.items.map((m) => (
              <MelodyRow
                key={m.id}
                melody={m}
                mine={m.owner === me}
                current={m.id === currentId}
                onPlay={() => void openMelody(m.id, true)}
                onOpen={() => void openMelody(m.id, false)}
                onCopy={() => void library.duplicate(m.id)}
                onDelete={() => void library.remove(m)}
              />
            ))
          : null}
      </ul>
      {list.status === "ready" && !list.items.length ? <p className={MUTED_P}>{EMPTY[scope]}</p> : null}
      <p className="mt-2.5 text-[12px] text-muted">{where}</p>
    </Modal>
  );
}

interface MelodyRowProps {
  melody: MelodySummary;
  mine: boolean;
  current: boolean;
  onPlay: () => void;
  onOpen: () => void;
  onCopy: () => void;
  onDelete: () => void;
}

/** "public · 12 notes · 0:06.0 · 120 BPM · 5 min ago (edited by ana)" */
export function describeMelody(m: MelodySummary, mine: boolean, now = Date.now()): string {
  const who = mine ? (m.public ? "public · " : "") : `by ${m.owner} · `;
  const edited = m.editedBy && m.editedBy !== m.owner ? ` (edited by ${m.editedBy})` : "";
  const length = formatTime((m.length * 60) / m.bpm);
  return `${who}${plural(m.noteCount, "note")} · ${length} · ${m.bpm} BPM · ${timeAgo(m.updatedAt, now)}${edited}`;
}

function MelodyRow({ melody: m, mine, current, onPlay, onOpen, onCopy, onDelete }: MelodyRowProps) {
  return (
    <li className={`${ROW} border bg-[#191c21] ${current ? "border-accent" : "border-line"}`}>
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <b className="truncate">{m.name}</b>
        <small className="text-[12px] text-muted">{describeMelody(m, mine)}</small>
      </div>
      <button
        type="button"
        className={ROW_BUTTON}
        title="Open and play"
        aria-label={`Play ${m.name}`}
        onClick={onPlay}
      >
        <Icon name="play" />
      </button>
      <button
        type="button"
        className={`${ROW_BUTTON} ${BUTTON.primary}`}
        title="Open to edit"
        onClick={onOpen}
      >
        Open
      </button>
      <button
        type="button"
        className={ROW_BUTTON}
        title="Make my own copy"
        aria-label={`Copy ${m.name}`}
        onClick={onCopy}
      >
        <Icon name="copy" />
      </button>
      {mine ? <DeleteButton name={m.name} onDelete={onDelete} /> : null}
    </li>
  );
}

/** Delete in two clicks: the first one arms it ("Delete?") for 3 s. */
function DeleteButton({ name, onDelete }: { name: string; onDelete: () => void }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const click = () => {
    clearTimeout(timer.current);
    if (armed) {
      setArmed(false);
      onDelete();
      return;
    }
    setArmed(true);
    timer.current = setTimeout(() => setArmed(false), 3000);
  };
  return (
    <button
      type="button"
      className={`${ROW_BUTTON} ${armed ? BUTTON.armed : BUTTON.danger}`}
      title="Delete"
      aria-label={`Delete ${name}`}
      onClick={click}
    >
      {armed ? "Delete?" : <Icon name="trash" />}
    </button>
  );
}
