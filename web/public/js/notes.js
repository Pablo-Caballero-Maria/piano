// Note names, frequencies, and the "resultant frequency" of notes sounding together.

export const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** True for the black keys (C#, D#, F#, G#, A#). */
export const isBlack = (m) => [1, 3, 6, 8, 10].includes(m % 12);

/** "C4" for MIDI note 60. */
export const noteName = (m) => NAMES[m % 12] + (Math.floor(m / 12) - 1);

/** Exact equal-temperament frequency of MIDI note m (A4 = 69 = 440 Hz). */
export const exactFreq = (m) => 440 * 2 ** ((m - 69) / 12);

/** Frequency of MIDI note m rounded to whole Hz (what the ESP32 receives). */
export const freqOf = (m) => Math.round(exactFreq(m));

/**
 * The single frequency the buzzer plays for several notes at once.
 * Adding two equal sine waves gives sin(a) + sin(b) = 2·cos((a−b)/2)·sin((a+b)/2):
 * a wave at the MEAN frequency (f1+f2)/2 whose loudness beats at |f1−f2|. A buzzer can
 * only hold one frequency, so it plays that mean; the same goes for more notes.
 * Duplicate notes count once. Returns whole Hz, 0 for no notes.
 */
export function resultant(midis) {
  const unique = [...new Set(midis)];
  if (!unique.length) return 0;
  return Math.round(unique.reduce((sum, m) => sum + exactFreq(m), 0) / unique.length);
}
