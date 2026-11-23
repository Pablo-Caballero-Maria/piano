/**
 * Tailwind classes that several components share. Every look is utility classes on the element (no
 * stylesheet rules): button() and field() put together, for each element, one class per property,
 * so no two of them compete.
 */

/**
 * A lucide-react icon inline with text (inline SVG: emoji fonts are missing on some PCs and look
 * different on each phone). A button's parent can make its icons smaller.
 */
export const ICON = "inline size-[18px] flex-none align-[-4px]";

/** What every button has: the pointer, no text wrapping, the disabled look, the keyboard focus ring. */
const BUTTON_BASE =
  "cursor-pointer touch-manipulation whitespace-nowrap disabled:cursor-default disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

/** The lighter border under the mouse (not on the red ones). */
const HOVER = "[&:hover:not(:disabled)]:border-hover-line";

/** Colours. A pressed toggle (aria-pressed) turns green unless its look says otherwise. */
const LOOKS = {
  plain: `border border-line bg-panel text-fg aria-pressed:border-accent aria-pressed:text-accent ${HOVER}`,
  /** The main action. */
  primary: `border border-accent bg-accent font-semibold text-on-accent ${HOVER}`,
  /** A main action that deletes or ends something. */
  primaryDanger: "border border-err bg-err font-semibold text-white",
  /** Deletes something: red text, and red all over once armed (the second click deletes). */
  danger: `border border-line bg-panel text-danger ${HOVER}`,
  armed: "border border-err bg-err text-white",
  /** Play/Stop: filled green while playing. */
  play: `border border-line bg-panel text-fg aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-on-accent ${HOVER}`,
  /** Record: a red dot, and all red (blinking) while recording. */
  record: `border border-line bg-panel text-err ${HOVER}`,
  recording: "animate-[blink_0.8s_infinite_alternate] border border-err bg-err text-white",
  /** A tab of the mode switch: no border, the selected one lighter. */
  tab: "border-0 bg-transparent text-muted aria-selected:bg-raised aria-selected:text-fg",
} as const;

/** Size and corners. */
const SHAPES = {
  text: "rounded-[10px] px-[13px] py-2 text-[14px]",
  /** Square, with only an icon. */
  icon: "w-[38px] rounded-[10px] px-0 py-[7px] text-center text-[14px]",
  /** The record button: the same, with a bigger font. */
  recordIcon: "w-[38px] rounded-[10px] px-0 py-[7px] text-center text-[16px]",
  /** Side by side as one control (Log in | Create account). */
  segment:
    "flex-1 rounded-none px-[13px] py-2 text-[14px] first:rounded-l-[10px] last:rounded-r-[10px] last:border-l-0",
  /** A tab of the mode switch (narrower on phones). */
  tab: "rounded-lg px-3 py-[7px] text-[14px] narrow:px-[9px]",
  /** The octave − and + buttons. */
  octave: "w-10 rounded-[10px] px-0 py-2 text-[14px]",
  /** The buttons of a melody or a person in a list. */
  row: "flex-none rounded-[10px] px-2.5 py-[7px] text-[14px]",
  /** The buttons of a name in the class panel's short lists. */
  listItem: "rounded-[10px] px-2.5 py-1.5 text-[14px]",
} as const;

export type ButtonLook = keyof typeof LOOKS;
export type ButtonShape = keyof typeof SHAPES;

/** A button's classes: its look (colours) and its shape (size, corners). */
export function button(look: ButtonLook = "plain", shape: ButtonShape = "text"): string {
  return `${BUTTON_BASE} ${LOOKS[look]} ${SHAPES[shape]}`;
}

/** A text field or a select; `large`: 16 px text, as in the login form. */
export function field(large = false): string {
  return `rounded-lg border border-line bg-panel px-2 py-[7px] text-fg select-text placeholder:[color:revert] placeholder:[opacity:revert] focus:outline-2 focus:outline-offset-1 focus:outline-accent ${large ? "text-[16px]" : "text-[14px]"}`;
}

/** Buttons side by side as one control: their group (its icons a bit smaller). */
export const SEGMENTED = "flex [&_svg]:size-[15px] [&_svg]:align-[-3px]";

/** Secondary text; as a paragraph it keeps the browser's 1em margins. */
export const MUTED = "text-[13px] text-muted";
export const MUTED_P = `my-[1em] ${MUTED}`;

/** A dialog's buttons, at its bottom right (or left, wrapping, inside the class panel). */
export const DIALOG_ROW = "mt-3.5 flex justify-end gap-2";
export const DIALOG_ROW_START = "mt-3.5 flex flex-wrap justify-start gap-2";
