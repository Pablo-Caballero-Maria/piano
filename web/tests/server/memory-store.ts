/** An accounts store in memory, with the rules of pianocore/accounts.py that Better Auth relies on. */
import type { Account, AccountsStore, Role, StoredSession } from "../../server/auth/store";
import { StoreError } from "../../server/auth/store";

export class MemoryStore implements AccountsStore {
  accounts = new Map<string, Account>();
  aliases = new Map<string, string>();
  sessions = new Map<string, StoredSession>();
  calls: string[] = [];

  constructor(private readonly userId: (name: string) => string) {}

  private record(call: string) {
    this.calls.push(call);
  }

  async get(uid: string) {
    this.record(`get ${uid}`);
    return this.accounts.get(uid) ?? null;
  }

  async candidates(username: string) {
    this.record(`candidates ${username}`);
    const out: Account[] = [];
    const direct = this.accounts.get(this.userId(username));
    if (direct) out.push(direct);
    const renamed = this.aliases.get(this.userId(username));
    if (renamed && this.accounts.has(renamed)) out.push(this.accounts.get(renamed)!);
    return out;
  }

  async find(username: string) {
    this.record(`find ${username}`);
    return (await this.candidates(username))[0] ?? null;
  }

  async taken(username: string) {
    this.record(`taken ${username}`);
    return this.accounts.has(this.userId(username));
  }

  async register(a: { username: string; role: Role; salt: string; hash: string }) {
    this.record(`register ${a.username}`);
    if (this.accounts.has(this.userId(a.username)))
      throw new StoreError("That username is already taken", 409);
    const account: Account = { uid: this.userId(a.username), ...a, created: 1, updated: 1 };
    this.accounts.set(account.uid, account);
    return account;
  }

  async putSession(s: StoredSession) {
    this.sessions.set(s.token, { ...s });
  }

  async getSession(token: string) {
    return this.sessions.get(token) ?? null;
  }

  async deleteSession(token: string) {
    this.sessions.delete(token);
  }

  async sessionsOf(uid: string) {
    return [...this.sessions.values()].filter((s) => s.uid === uid);
  }

  async deleteSessionsOf(uid: string) {
    const mine = await this.sessionsOf(uid);
    mine.forEach((s) => this.sessions.delete(s.token));
    return mine.length;
  }
}
