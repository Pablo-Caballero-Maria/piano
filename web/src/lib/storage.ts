/**
 * This browser's localStorage, for small things the page remembers (the session, the sound
 * setting, the studio's draft). It may be missing or full (private mode), or not exist at all
 * (the build, which renders the page on the server): then nothing is remembered.
 */

const storage = (): Storage | null => (typeof window === "undefined" ? null : window.localStorage);

export function readItem(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeItem(key: string, value: string | null): void {
  try {
    if (value === null) storage()?.removeItem(key);
    else storage()?.setItem(key, value);
  } catch {
    // full or blocked: not remembered
  }
}

export function readJSON<T>(key: string): T | null {
  const text = readItem(key);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export const writeJSON = (key: string, value: unknown): void =>
  writeItem(key, value === null ? null : JSON.stringify(value));

/** Keys the page uses (one place, so they never clash). */
export const STORAGE_KEYS = {
  session: "piano-session",
  sound: "piano-sound",
  mode: "piano-mode",
  studioDraft: "piano-studio-draft",
  studioKeyboard: "piano-studio-kb",
  theme: "piano-theme",
} as const;
