/**
 * The on-screen keyboard's layout, and the computer keys that play it.
 * Computer keys go by physical position (KeyboardEvent.code), so they work on any layout:
 * A W S E D F T G Y H U J K O L P ; ' are the semitones from the first C; Z / X change octave.
 */
import { isBlack } from "./notes";

export const KEY_CODES = [
  "KeyA",
  "KeyW",
  "KeyS",
  "KeyE",
  "KeyD",
  "KeyF",
  "KeyT",
  "KeyG",
  "KeyY",
  "KeyH",
  "KeyU",
  "KeyJ",
  "KeyK",
  "KeyO",
  "KeyL",
  "KeyP",
  "Semicolon",
  "Quote",
] as const;

export const OCTAVE_DOWN = "KeyZ";
export const OCTAVE_UP = "KeyX";
export const MIN_OCTAVE = 1;
export const MAX_OCTAVE = 6;

/** Semitones above the keyboard's first C for a computer key, or -1. */
export const keyOffset = (code: string): number => (KEY_CODES as readonly string[]).indexOf(code);

/** The leftmost key of a keyboard starting at octave o is C<o>. */
export const baseMidi = (octave: number): number => 12 * (octave + 1);

/** One key of the on-screen keyboard; black keys sit over the gap after white key `after`. */
export interface KeyLayout {
  midi: number;
  black: boolean;
  /** Black keys: their centre and width, in % of the keyboard's width. */
  left?: number;
  width?: number;
}

/** whiteCount white keys from C<octave>, plus the black keys between them. */
export function layoutKeys(octave: number, whiteCount: number): KeyLayout[] {
  const keys: KeyLayout[] = [];
  let whites = 0;
  for (let m = baseMidi(octave); whites < whiteCount; m++) {
    if (isBlack(m)) continue;
    keys.push({ midi: m, black: false });
    whites++;
    if (whites < whiteCount && isBlack(m + 1)) {
      keys.push({ midi: m + 1, black: true, left: (whites / whiteCount) * 100, width: 58 / whiteCount });
    }
  }
  return keys;
}

/** How many white keys fit a keyboard `width` px wide (wider keys on touch screens). */
export const whiteKeysFor = (width: number, coarse: boolean): number =>
  Math.max(7, Math.min(22, Math.floor(width / (coarse ? 44 : 52))));

const FALLBACK_LABELS: Record<string, string> = { Semicolon: ";", Quote: "'" };

/** The label of the computer key for a code ("A" for KeyA; the layout's own key if known). */
export function keyLabel(code: string, layout?: ReadonlyMap<string, string> | null): string {
  const label = layout?.get(code) ?? FALLBACK_LABELS[code] ?? code.slice(3);
  return label.toUpperCase();
}
