/** Test doubles for the class link's transports. */
import type { AblyChannel, AblyMessage, AblyPresenceMember, AblySdk } from "@/services/link/ably-sdk";

/** A WebSocket the test drives: open(), receive(msg), drop(code). */
export class FakeSocket {
  static readonly OPEN = 1;
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;

  constructor(readonly url: string) {}

  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

/** Ably, in memory: channels that record what's published and let the test deliver messages. */
export class FakeAbly implements AblySdk {
  channels = new Map<string, FakeChannel>();
  handlers: Record<string, () => void> = {};
  authCallback: Parameters<AblySdk["createClient"]>[0]["authCallback"] | null = null;
  closed = false;

  createClient: AblySdk["createClient"] = (options) => {
    this.authCallback = options.authCallback;
    return {
      channels: {
        get: (name: string) => {
          if (!this.channels.has(name)) this.channels.set(name, new FakeChannel());
          return this.channels.get(name)!;
        },
      },
      connection: { on: (event, fn) => void (this.handlers[event] = fn) },
      close: () => void (this.closed = true),
    };
  };
}

export class FakeChannel implements AblyChannel {
  published: [string, unknown][] = [];
  listener: ((m: AblyMessage) => void) | null = null;
  members: AblyPresenceMember[] = [];
  presenceListener: (() => void) | null = null;
  entered: unknown[] = [];
  updates: unknown[] = [];
  left = 0;

  subscribe(listener: (m: AblyMessage) => void) {
    this.listener = listener;
  }
  unsubscribe() {
    this.listener = null;
  }
  async publish(name: string, data: unknown) {
    this.published.push([name, data]);
  }
  presence = {
    enter: async (data?: unknown) => void this.entered.push(data),
    update: async (data?: unknown) => void this.updates.push(data),
    leave: async () => void this.left++,
    get: async () => this.members,
    subscribe: (fn: () => void) => void (this.presenceListener = fn),
    unsubscribe: () => void (this.presenceListener = null),
  };
}
