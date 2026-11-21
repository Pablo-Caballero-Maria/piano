import { noteName } from "@/lib/notes";

const UNIT = "ml-1.5 text-[14px] font-medium text-muted";

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
        <small className={UNIT}>{freq} Hz</small>
      </>
    );
  } else if (names.length > 1) {
    const shown = names.length > 4 ? `${names.slice(0, 4).join("+")}…` : names.join("+");
    content = (
      <>
        {shown}
        <small className={UNIT}>→ {freq} Hz</small>
      </>
    );
  }
  return (
    <div
      className={`now font-bold whitespace-nowrap tabular-nums ${
        small
          ? "mr-0 ml-auto min-w-[6ch] text-[18px] small-screen:order-10 small-screen:ml-0"
          : "mr-auto min-w-[7ch] text-[28px] short:text-[22px]"
      }`}
      title={title}
    >
      {content}
    </div>
  );
}
