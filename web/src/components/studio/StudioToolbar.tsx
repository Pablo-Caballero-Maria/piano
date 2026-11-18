"use client";

/** The studio's toolbar: the melody (name, save, open, public), transport, tempo, snap and editing tools. */
import { Icon } from "@/components/ui/Icon";
import { NowPlaying } from "@/components/piano/NowPlaying";
import { useStore } from "@/hooks/useStore";
import { api } from "@/services";
import { DEFAULT_NAME, SNAPS } from "@/studio/constants";
import type { StudioEngine } from "@/studio/engine";
import type { MelodyLibrary } from "@/studio/library";
import { BpmField } from "./BpmField";

export interface StudioToolbarProps {
  studio: StudioEngine;
  library: MelodyLibrary;
  onOpenList: () => void;
}

export function StudioToolbar({ studio, library, onOpenList }: StudioToolbarProps) {
  const s = useStore(studio.store);
  const clock = useStore(studio.clock);
  const saving = useStore(library.saving);
  const me = useStore(api.session, null)?.user.username ?? null;
  const following = !!s.following;
  const mine = !s.owner || s.owner === me;
  const publicTitle = !mine
    ? `Public melody by ${s.owner}: everyone can edit it; only they can make it private`
    : s.isPublic
      ? "Public: everyone can see and edit it"
      : "Private: only you see it";

  return (
    <div className="toolbar">
      <div className="group file">
        <input
          className="melody-name"
          maxLength={80}
          placeholder={DEFAULT_NAME}
          aria-label="Melody name"
          spellCheck={false}
          value={s.name}
          readOnly={following}
          onChange={(e) => studio.setName(e.target.value)}
        />
        <span className="save-state" data-state={s.dirty ? "dirty" : "saved"}>
          {s.dirty ? "● Unsaved" : s.id ? "✓ Saved" : ""}
        </span>
        <button
          type="button"
          title="New melody"
          disabled={following}
          onClick={() => void library.newMelody()}
        >
          New
        </button>
        <button type="button" title="My melodies and everyone's public ones" onClick={onOpenList}>
          <Icon name="folder" />
          <span className="lbl"> My melodies</span>
        </button>
        <button
          type="button"
          className="icon"
          title={publicTitle}
          aria-label="Public or private"
          aria-pressed={s.isPublic}
          disabled={!mine || following}
          onClick={() => studio.togglePublic()}
        >
          <Icon name={s.isPublic ? "globe" : "lock"} />
        </button>
        <button
          type="button"
          className="primary"
          title="Save to my account (Ctrl+S)"
          disabled={saving || following}
          onClick={() => void library.save()}
        >
          <Icon name="save" />
          <span className="lbl"> Save</span>
        </button>
      </div>

      <div className="group transport">
        <button
          type="button"
          className="icon"
          title="Back to the start"
          aria-label="Back to the start"
          onClick={() => studio.seek(0)}
        >
          <Icon name="start" />
        </button>
        <button
          type="button"
          className="icon play"
          title={s.playing ? "Stop (Space)" : "Play (Space)"}
          aria-label={s.playing ? "Stop" : "Play"}
          aria-pressed={s.playing}
          onClick={() => studio.togglePlay()}
        >
          <Icon name={s.playing ? "stop" : "play"} />
        </button>
        <button
          type="button"
          className={s.recording ? "icon rec recording" : "icon rec"}
          title="Record from the piano: notes you play are added"
          aria-label="Record"
          aria-pressed={s.recording}
          disabled={following}
          onClick={() => studio.toggleRecord()}
        >
          <Icon name="rec" />
        </button>
        <button
          type="button"
          className="icon"
          title="Loop"
          aria-label="Loop"
          aria-pressed={s.looping}
          onClick={() => studio.toggleLoop()}
        >
          <Icon name="loop" />
        </button>
        <button
          type="button"
          className="icon"
          title="Metronome (device speaker only)"
          aria-label="Metronome"
          aria-pressed={s.metronome}
          onClick={() => studio.toggleMetronome()}
        >
          <Icon name="metro" />
        </button>
      </div>

      <span className="clock">{clock}</span>

      <div className="group">
        <BpmField bpm={s.bpm} onCommit={(v) => studio.setBpm(v)} />
        <label className="field">
          Snap{" "}
          <select value={String(s.snap)} onChange={(e) => studio.setSnap(Number(e.target.value))}>
            {SNAPS.map((o) => (
              <option key={o.value} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="group">
        <button
          type="button"
          className="icon"
          title="Draw: click to add a note, drag to move it, drag its right edge to resize. Right-click deletes."
          aria-label="Draw"
          aria-pressed={s.tool === "draw"}
          onClick={() => studio.setTool("draw")}
        >
          <Icon name="pencil" />
        </button>
        <button
          type="button"
          className="icon"
          title="Erase: click or drag over notes to delete them"
          aria-label="Erase"
          aria-pressed={s.tool === "erase"}
          onClick={() => studio.setTool("erase")}
        >
          <Icon name="eraser" />
        </button>
        <button
          type="button"
          className="icon"
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          disabled={!s.canUndo}
          onClick={() => studio.undo()}
        >
          <Icon name="undo" />
        </button>
        <button
          type="button"
          className="icon"
          title="Redo (Ctrl+Y)"
          aria-label="Redo"
          disabled={!s.canRedo}
          onClick={() => studio.redo()}
        >
          <Icon name="redo" />
        </button>
        <button
          type="button"
          className="icon"
          title="Zoom out (Ctrl+wheel)"
          aria-label="Zoom out"
          onClick={() => studio.zoom(1 / 1.25)}
        >
          <Icon name="zout" />
        </button>
        <button
          type="button"
          className="icon"
          title="Zoom in (Ctrl+wheel)"
          aria-label="Zoom in"
          onClick={() => studio.zoom(1.25)}
        >
          <Icon name="zin" />
        </button>
        <button
          type="button"
          className="icon"
          title="Show/hide the piano"
          aria-label="Show the piano"
          aria-pressed={!s.keyboardHidden}
          onClick={() => studio.toggleKeyboard()}
        >
          <Icon name="piano" />
        </button>
      </div>
      <NowPlaying
        small
        pitches={s.sounding}
        freq={s.freq}
        title="What the buzzer plays: overlapping notes give their resultant (mean) frequency"
      />
    </div>
  );
}
