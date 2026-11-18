/**
 * Ably's browser SDK, loaded only when the page is online (Vercel). Accounts on MAU pricing only
 * accept the v3 device SDK in browsers (error 40168 with v2), which isn't on npm: it's loaded from
 * Ably's CDN. These are the few parts of it the page uses.
 */

export const ABLY_SDK_URL = "https://cdn.ably.com/lib/ably.min-3.js";

export interface AblyMessage {
  name?: string;
  data?: unknown;
}

export interface AblyPresenceMember {
  clientId: string;
  data?: unknown;
}

export interface AblyPresence {
  enter(data?: unknown): Promise<void>;
  update(data?: unknown): Promise<void>;
  leave(): Promise<void>;
  get(): Promise<AblyPresenceMember[]>;
  subscribe(listener: () => void): void;
  unsubscribe(): void;
}

export interface AblyChannel {
  subscribe(listener: (msg: AblyMessage) => void): void;
  unsubscribe(): void;
  publish(name: string, data: unknown): Promise<void>;
  readonly presence: AblyPresence;
}

/** Ably's auth callback: our server (api/index.py) signs a token request for the user. */
export type AuthCallback = (
  params: unknown,
  callback: (error: string | null, tokenRequest: unknown) => void,
) => void;

export interface AblyRealtime {
  readonly channels: { get(name: string): AblyChannel };
  readonly connection: { on(event: "connected" | "disconnected" | "failed", listener: () => void): void };
  close(): void;
}

export interface AblySdk {
  createClient(options: { authCallback: AuthCallback }): AblyRealtime;
}

declare global {
  interface Window {
    AblyPubSub?: AblySdk;
  }
}

let loading: Promise<AblySdk> | null = null;

/** Load the SDK (once) and resolve to it. */
export function loadAbly(): Promise<AblySdk> {
  loading ??= new Promise<AblySdk>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = ABLY_SDK_URL;
    script.async = true;
    script.onload = () =>
      window.AblyPubSub ? resolve(window.AblyPubSub) : reject(new Error("Couldn't load Ably"));
    script.onerror = () => {
      loading = null; // try again next time
      reject(new Error("Couldn't load Ably"));
    };
    document.head.append(script);
  });
  return loading;
}
