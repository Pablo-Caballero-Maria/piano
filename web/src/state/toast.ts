/** Short messages at the bottom of the screen (<Toaster/> shows them). */
import { Store } from "@/lib/store";

export type ToastKind = "ok" | "error";

export interface ToastMessage {
  id: number;
  message: string;
  kind: ToastKind;
}

const SHOW_MS: Record<ToastKind, number> = { ok: 2200, error: 4500 };

export const toastStore = new Store<ToastMessage | null>(null);
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Show a message for a moment (errors a bit longer); a new one replaces the old one. */
export function toast(message: string, kind: ToastKind = "ok"): void {
  const id = nextId++;
  toastStore.set({ id, message, kind });
  clearTimeout(timer);
  timer = setTimeout(() => toastStore.set((t) => (t?.id === id ? null : t)), SHOW_MS[kind]);
}
