"use client";

/** The studio's toolbar: the melody (name, save, open, public), transport, tempo, snap and editing tools. */
import {
  CircleSmall,
  Eraser,
  Folder,
  Globe,
  Lock,
  Metronome,
  Pencil,
  Piano,
  Play,
  Redo2,
  Repeat,
  Save,
  SkipBack,
  Square,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { BUTTON, ICON } from "@/components/ui/classes";
import { NowPlaying } from "@/components/piano/NowPlaying";
import { useStore } from "@/hooks/useStore";
import { api } from "@/services";
import { DEFAULT_NAME, SNAPS } from "@/studio/constants";
import type { StudioEngine } from "@/studio/engine";
import type { MelodyLibrary } from "@/studio/library";
import { BpmField } from "./BpmField";

/** A group of tools that stays together. */
const GROUP = "flex flex-none items-center gap-1.5";
/** A button's text next to its icon: on small screens the icon alone. */
const LABEL = "small-screen:hidden";

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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 pb-2 small-screen:[scrollbar-width:none] small-screen:flex-nowrap small-screen:gap-x-3 small-screen:overflow-x-auto small-screen:[&::-webkit-scrollbar]:hidden">
      <div className={GROUP}>
        <input
          className="w-[15ch] font-semibold small-screen:w-[11ch]"
          maxLength={80}
          placeholder={DEFAULT_NAME}
          aria-label="Melody name"
          spellCheck={false}
          value={s.name}
          readOnly={following}
          onChange={(e) => studio.setName(e.target.value)}
        />
        <span
          className={`save-state min-w-[7ch] text-[12px] ${s.dirty ? "text-warn" : "text-muted"}`}
          data-state={s.dirty ? "dirty" : "saved"}
        >
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
          <Folder className={ICON} />
          <span className={LABEL}> My melodies</span>
        </button>
        <button
          type="button"
          className={BUTTON.icon}
          title={publicTitle}
          aria-label="Public or private"
          aria-pressed={s.isPublic}
          disabled={!mine || following}
          onClick={() => studio.togglePublic()}
        >
          {s.isPublic ? <Globe className={ICON} /> : <Lock className={ICON} />}
        </button>
        <button
          type="button"
          className={BUTTON.primary}
          title="Save to my account (Ctrl+S)"
          disabled={saving || following}
          onClick={() => void library.save()}
        >
          <Save className={ICON} />
          <span className={LABEL}> Save</span>
        </button>
      </div>

      <div className={GROUP}>
        <button
          type="button"
          className={BUTTON.icon}
          title="Back to the start"
          aria-label="Back to the start"
          onClick={() => studio.seek(0)}
        >
          <SkipBack className={ICON} fill="currentColor" />
        </button>
        <button
          type="button"
          className={`${BUTTON.icon} aria-pressed:bg-accent aria-pressed:text-[#06140d]`}
          title={s.playing ? "Stop (Space)" : "Play (Space)"}
          aria-label={s.playing ? "Stop" : "Play"}
          aria-pressed={s.playing}
          onClick={() => studio.togglePlay()}
        >
          {s.playing ? (
            <Square className={ICON} fill="currentColor" />
          ) : (
            <Play className={ICON} fill="currentColor" />
          )}
        </button>
        <button
          type="button"
          className={`${BUTTON.icon} text-[16px] ${s.recording ? "animate-[blink_0.8s_infinite_alternate] border-err bg-err text-white" : "text-err"}`}
          title="Record from the piano: notes you play are added"
          aria-label="Record"
          aria-pressed={s.recording}
          disabled={following}
          onClick={() => studio.toggleRecord()}
        >
          <CircleSmall className={ICON} fill="currentColor" />
        </button>
        <button
          type="button"
          className={BUTTON.icon}
          title="Loop"
          aria-label="Loop"
          aria-pressed={s.looping}
          onClick={() => studio.toggleLoop()}
        >
          <Repeat className={ICON} />
        </button>
        <button
          type="button"
          className={BUTTON.icon}
          title="Metronome (device speaker only)"
          aria-label="Metronome"
          aria-pressed={s.metronome}
          onClick={() => studio.toggleMetronome()}
        >
          <Metronome className={ICON} />
        </button>
      </div>

      <span className="min-w-[19ch] text-[13px] whitespace-pre text-muted tabular-nums small-screen:order-10">
        {clock}
      </span>

      <div className={GROUP}>
        <BpmField bpm={s.bpm} onCommit={(v) => studio.setBpm(v)} />
        <label className="flex items-center gap-1.5 text-[13px] text-muted">
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

      <div className={GROUP}>
        <button
          type="button"
          className={BUTTON.icon}
          title="Draw: click to add a note, drag to move it, drag its right edge to resize. Right-click deletes."
          aria-label="Draw"
          aria-pressed={s.tool === "draw"}
          onClick={() => studio.setTool("draw")}
        >
          <Pencil className={ICON} />
        </button>
        <button
          type="button"
          className={BUTTON.icon}
          title="Erase: click or drag over notes to delete them"
          aria-label="Erase"
          aria-pressed={s.tool === "erase"}
          onClick={() => studio.setTool("erase")}
        >
          <Eraser className={ICON} />
        </button>
        <button
          type="button"
          className={BUTTON.icon}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          disabled={!s.canUndo}
          onClick={() => studio.undo()}
        >
          <Undo2 className={ICON} />
        </button>
        <button
          type="button"
          className={BUTTON.icon}
          title="Redo (Ctrl+Y)"
          aria-label="Redo"
          disabled={!s.canRedo}
          onClick={() => studio.redo()}
        >
          <Redo2 className={ICON} />
        </button>
        <button
          type="button"
          className={BUTTON.icon}
          title="Zoom out (Ctrl+wheel)"
          aria-label="Zoom out"
          onClick={() => studio.zoom(1 / 1.25)}
        >
          <ZoomOut className={ICON} />
        </button>
        <button
          type="button"
          className={BUTTON.icon}
          title="Zoom in (Ctrl+wheel)"
          aria-label="Zoom in"
          onClick={() => studio.zoom(1.25)}
        >
          <ZoomIn className={ICON} />
        </button>
        <button
          type="button"
          className={BUTTON.icon}
          title="Show/hide the piano"
          aria-label="Show the piano"
          aria-pressed={!s.keyboardHidden}
          onClick={() => studio.toggleKeyboard()}
        >
          <Piano className={ICON} />
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
