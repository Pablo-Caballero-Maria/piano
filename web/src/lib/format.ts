/** Text for times and dates shown on the page. */

/** "1:05.3" for a time in seconds. */
export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

/** "just now", "5 min ago", "3 h ago", or the date, for when something happened. */
export function timeAgo(date: string | number | Date, now: number = Date.now()): string {
  const s = (now - new Date(date).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(date).toLocaleDateString();
}

/** "1 note", "3 notes". */
export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
