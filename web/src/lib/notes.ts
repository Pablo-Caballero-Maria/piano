/**
 * Note names, frequencies, and the "resultant frequency" of notes sounding together.
 * Notes are MIDI numbers (60 = C4); frequencies are in Hz.
 */

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

/** True for the black keys (C#, D#, F#, G#, A#). */
export const isBlack = (midi: number): boolean => BLACK_KEYS.has(midi % 12);

/** "C4" for MIDI note 60. */
export const noteName = (midi: number): string => NOTE_NAMES[midi % 12] + String(Math.floor(midi / 12) - 1);

/** Names of several notes, "C4 E4 G4". */
export const noteNames = (midis: readonly number[]): string => midis.map(noteName).join(" ");

/** Exact equal-temperament frequency of MIDI note m (A4 = 69 = 440 Hz). */
export const exactFreq = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** Frequency of MIDI note m rounded to whole Hz (what the ESP32 receives). */
export const freqOf = (midi: number): number => Math.round(exactFreq(midi));

/**
 * The single frequency the buzzer plays for several notes at once.
 * Adding two equal sine waves gives sin(a) + sin(b) = 2·cos((a−b)/2)·sin((a+b)/2):
 * a wave at the MEAN frequency (f1+f2)/2 whose loudness beats at |f1−f2|. A buzzer can
 * only hold one frequency, so it plays that mean; the same goes for more notes.
 * Duplicate notes count once. Returns whole Hz, 0 for no notes.
 */
export function resultant(midis: Iterable<number>): number {
  const unique = [...new Set(midis)];
  if (!unique.length) return 0;
  return Math.round(unique.reduce((sum, m) => sum + exactFreq(m), 0) / unique.length);
}
