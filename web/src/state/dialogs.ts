/**
 * Dialogs other code can open and wait for: a yes/no question (<ConfirmDialog/>, instead of
 * window.confirm) and the login dialog (<AuthDialog/>). Each is a request in a store that the
 * dialog component shows and resolves.
 */
import { Store } from "@/lib/store";

export interface ConfirmRequest {
  message: string;
  okLabel: string;
  resolve: (ok: boolean) => void;
}

export const confirmStore = new Store<ConfirmRequest | null>(null);

/** Ask a yes/no question; resolves true if the user picks okLabel. */
export function confirmDialog(message: string, okLabel = "OK"): Promise<boolean> {
  confirmStore.get()?.resolve(false);
  return new Promise((resolve) => confirmStore.set({ message, okLabel, resolve }));
}

export interface AuthRequest {
  /** Why we ask ("Log in to save your melodies"), or "". */
  reason: string;
  resolve: (loggedIn: boolean) => void;
}

export const authStore = new Store<AuthRequest | null>(null);

/** Open the login dialog; resolves true once the user is logged in, false if they cancel. */
export function openAuth(reason = ""): Promise<boolean> {
  authStore.get()?.resolve(false);
  return new Promise((resolve) => authStore.set({ reason, resolve }));
}
