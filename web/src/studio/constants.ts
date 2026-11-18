/** The piano roll's fixed sizes and limits. */

/** Rows: C1 (33 Hz) up to B8 (7902 Hz). */
export const LOW = 24;
export const HIGH = 119;
export const BEATS_PER_BAR = 4;
/** The timeline is never shorter than this (and always 4 empty bars longer than the melody). */
export const MIN_BARS = 16;
/** Width of the piano-key column, px (also in piano-roll.css). */
export const KEY_W = 64;
/** Silence inserted when the same frequency is struck again, so it's heard as a new note. */
export const GAP_SEC = 0.05;
/** Shortest note (beats) when snap is off. */
export const MIN_LEN = 1 / 32;
export const MAX_UNDO = 200;
export const DEFAULT_NAME = "Untitled melody";
export const DEFAULT_BPM = 120;
export const MIN_BPM = 20;
export const MAX_BPM = 400;
/** Zoom limits, px per beat. */
export const MIN_PPB = 12;
export const MAX_PPB = 320;

/** Grid snap choices, in beats (0 = off). */
export const SNAPS = [
  { value: 0.125, label: "1/32" },
  { value: 0.25, label: "1/16" },
  { value: 0.5, label: "1/8" },
  { value: 1, label: "1/4 (beat)" },
  { value: 2, label: "1/2" },
  { value: 4, label: "Bar" },
  { value: 0, label: "Off" },
] as const;
