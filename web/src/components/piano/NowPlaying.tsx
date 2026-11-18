import { noteName } from "@/lib/notes";

/**
 * What sounds now: "C4 262 Hz" for one note; "C4+E4 → 296 Hz" for several (their resultant
 * frequency, what the buzzer plays); "–" for silence.
 */
export function NowPlaying({
  pitches,
  freq,
  small = false,
  title,
}: {
  pitches: readonly number[];
  freq: number;
  small?: boolean;
  title?: string;
}) {
  const names = pitches.map(noteName);
  let content: React.ReactNode = "–";
  if (names.length === 1) {
    content = (
      <>
        {names[0]}
        <small>{freq} Hz</small>
      </>
    );
  } else if (names.length > 1) {
    const shown = names.length > 4 ? `${names.slice(0, 4).join("+")}…` : names.join("+");
    content = (
      <>
        {shown}
        <small>→ {freq} Hz</small>
      </>
    );
  }
  return (
    <div className={small ? "now small" : "now"} title={title}>
      {content}
    </div>
  );
}
