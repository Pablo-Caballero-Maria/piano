/**
 * Tailwind classes that several components share. The plain look of buttons and fields is in
 * globals.css (@layer base); these are the variants.
 */

/**
 * A lucide-react icon inline with text (inline SVG: emoji fonts are missing on some PCs and look
 * different on each phone). A button's parent can make its icons smaller.
 */
export const ICON = "inline size-[18px] flex-none align-[-4px]";

export const BUTTON = {
  /** The main action. Like every button, its border lightens on hover. */
  primary: "border-accent bg-accent font-semibold text-[#06140d] [&:hover:not(:disabled)]:border-[#4a505c]",
  /** A main action that deletes or ends something. */
  primaryDanger: "border-err bg-err font-semibold text-white",
  /** Square, with only an icon. */
  icon: "w-[38px] px-0 py-[7px] text-center",
  /** Deletes something: red text, and red all over once armed (the second click deletes). */
  danger: "text-[#ff9b9e]",
  armed: "border-err bg-err text-white",
} as const;

/** Buttons side by side as one control (Log in | Create account), the pressed one highlighted. */
export const SEGMENTED = {
  group: "flex [&_svg]:size-[15px] [&_svg]:align-[-3px]",
  button: "flex-1 rounded-none first:rounded-l-[10px] last:rounded-r-[10px] last:border-l-0",
} as const;

/** Secondary text; as a paragraph it keeps the browser's 1em margins. */
export const MUTED = "text-[13px] text-muted";
export const MUTED_P = `my-[1em] ${MUTED}`;

/** A dialog's buttons, at its bottom right (or left, wrapping, inside the class panel). */
export const DIALOG_ROW = "mt-3.5 flex justify-end gap-2";
export const DIALOG_ROW_START = "mt-3.5 flex flex-wrap justify-start gap-2";
