/**
 * The one sound output: every mode calls output(f, midi), which plays a square wave on this
 * phone/PC (device sound, on by default) and tells the class (the link): the teacher's PC sends
 * it to the buzzer if this user holds it, and shows it to the teacher (and, for a live teacher, to
 * every student). Also the metronome click (device speaker only, never the buzzer).
 */
import { readItem, STORAGE_KEYS, writeItem } from "@/lib/storage";
import { Store } from "@/lib/store";

/** Where notes go besides this device's speaker (the class link). */
export interface NoteSink {
  note(freq: number, midi: number[]): void;
}

type AudioContextClass = typeof AudioContext;

const VOLUME = 0.06;
const MAX_FREQ = 65535;

export class SoundOutput {
  /** Device sound on/off (remembered in this browser). */
  readonly deviceSound: Store<boolean>;
  private current = 0;
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;

  constructor(
    private readonly sink: NoteSink,
    private readonly AudioCtx: () => AudioContextClass | undefined = () =>
      globalThis.AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext,
  ) {
    this.deviceSound = new Store(readItem(STORAGE_KEYS.sound) !== "0");
  }

  /** Play f Hz (0 = silence), the sounding MIDI notes being midi; nothing if f is already playing. */
  output(f: number, midi: readonly number[] = []): void {
    f = Math.max(0, Math.min(MAX_FREQ, Math.round(f)));
    if (f === this.current) return;
    this.current = f;
    this.sink.note(f, f ? [...midi] : []);
    this.localTone(f);
  }

  currentFreq = (): number => this.current;

  /** Turn the device speaker on/off. Call from a user gesture (it may start the audio). */
  setDeviceSound(on: boolean): void {
    this.deviceSound.set(on);
    writeItem(STORAGE_KEYS.sound, on ? "1" : "0");
    if (on) this.unlockAudio();
    this.localTone(on ? this.current : 0);
  }

  /**
   * Browsers only allow audio after a user gesture, so the AudioContext is created on the first
   * key or button press. Safe to call often.
   */
  unlockAudio(): void {
    if (!this.ctx) {
      const AC = this.AudioCtx();
      if (!AC) return;
      const ctx = new AC();
      const osc = ctx.createOscillator();
      osc.type = "square";
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      Object.assign(this, { ctx, osc, gain });
    }
    if (this.ctx?.state === "suspended") void this.ctx.resume();
  }

  /** Play f Hz (0 = silence) on this device, with short ramps to avoid clicks. */
  private localTone(f: number): void {
    const { ctx, osc, gain } = this;
    if (!ctx || !osc || !gain) return;
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    if (f && this.deviceSound.get()) {
      osc.frequency.setValueAtTime(f, t);
      gain.gain.setTargetAtTime(VOLUME, t, 0.004);
    } else {
      gain.gain.setTargetAtTime(0, t, 0.01);
    }
  }

  /** A short metronome tick on the device speaker (higher on the first beat of a bar). */
  click(accent: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = accent ? 1760 : 1175;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.06);
  }
}
