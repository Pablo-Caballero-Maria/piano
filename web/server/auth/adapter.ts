/**
 * Better Auth's database adapter for piano: its models on top of the accounts store (store.ts),
 * so accounts stay the same sealed records with the same rules as before Better Auth.
 *
 * - `user` and `account` (the credential: the password hash) are two views of one piano account.
 *   A sign-up creates the user first and links its password right after; the account is only
 *   registered (in one call, with piano's checks) when the password arrives, so a half-made
 *   account never exists. The user's id is piano's uid, a keyed hash of the username.
 * - `session` maps onto the store's sessions.
 *
 * Only the queries Better Auth makes for piano's flows (sign up, sign in, the session, sign out)
 * are answered; anything else throws, so an unexpected one shows up in the tests instead of
 * quietly doing the wrong thing.
 */
import { createAdapterFactory, type CleanedWhere } from "better-auth/adapters";
import { joinHash, splitHash } from "./password.js";
import type { Account, AccountsStore, Role, StoredSession } from "./store.js";

/** The e-mail address Better Auth requires: derived from the username, on the reserved .invalid domain. */
export const emailOf = (username: string): string => `${username.toLowerCase()}@piano.invalid`;

const usernameOfEmail = (email: string): string => email.replace(/@piano\.invalid$/i, "");

type Row = Record<string, unknown>;

export function userRow(account: Account): Row {
  return {
    id: account.uid,
    name: account.username,
    email: emailOf(account.username),
    emailVerified: false,
    image: null,
    createdAt: new Date(account.created),
    updatedAt: new Date(account.updated),
    username: account.username.toLowerCase(),
    displayUsername: account.username,
    role: account.role,
  };
}

export function accountRow(account: Account): Row {
  return {
    id: account.uid,
    userId: account.uid,
    accountId: account.uid,
    providerId: "credential",
    password: joinHash(account.salt, account.hash),
    accessToken: null,
    refreshToken: null,
    idToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    scope: null,
    createdAt: new Date(account.created),
    updatedAt: new Date(account.updated),
  };
}

export function sessionRow(session: StoredSession): Row {
  return {
    id: session.id,
    token: session.token,
    userId: session.uid,
    expiresAt: new Date(session.expires),
    createdAt: new Date(session.created),
    updatedAt: new Date(session.updated),
    ipAddress: session.ip || null,
    userAgent: session.agent || null,
  };
}

const ms = (value: unknown): number =>
  value instanceof Date ? value.getTime() : Number(new Date(String(value)));

function toStoredSession(row: Row): StoredSession {
  return {
    id: String(row.id),
    token: String(row.token),
    uid: String(row.userId),
    expires: ms(row.expiresAt),
    created: row.createdAt ? ms(row.createdAt) : Date.now(),
    updated: row.updatedAt ? ms(row.updatedAt) : Date.now(),
    ip: typeof row.ipAddress === "string" ? row.ipAddress : "",
    agent: typeof row.userAgent === "string" ? row.userAgent : "",
  };
}

export class UnsupportedQuery extends Error {
  constructor(what: string) {
    super(`The piano adapter doesn't support ${what}`);
    this.name = "UnsupportedQuery";
  }
}

/** The where clause as field → value, if it's only equalities joined by AND (all Better Auth asks here). */
function equalities(model: string, where: CleanedWhere[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const w of where) {
    if (w.operator !== "eq" || (w.connector !== "AND" && where.length > 1))
      throw new UnsupportedQuery(`${model} where ${w.field} ${w.operator}`);
    out[w.field] = w.value;
  }
  return out;
}

const only = (q: Record<string, unknown>, ...fields: string[]) =>
  Object.keys(q).every((k) => fields.includes(k)) && fields.every((f) => f in q);

/**
 * The uid of a query on the credential account (Better Auth asks by userId, sometimes with the
 * providerId and accountId too, which for piano are "credential" and the uid), or null if it
 * asks for another kind of account.
 */
function credentialOf(q: Record<string, unknown>): string | null | undefined {
  const keys = Object.keys(q);
  if (!keys.length || !keys.every((k) => ["userId", "providerId", "accountId"].includes(k))) return undefined;
  if (q.providerId !== undefined && q.providerId !== "credential") return null;
  const uid = String(q.userId ?? q.accountId);
  if (q.accountId !== undefined && String(q.accountId) !== uid) return null;
  return uid;
}

interface PendingUser {
  username: string;
  role: Role;
}

/**
 * The adapter. `userId` is piano's keyed hash of a username (keys.ts), the id a new account will
 * have; the store computes the same one.
 */
export function pianoAdapter(store: AccountsStore, userId: (username: string) => string) {
  // Users made by a sign-up, waiting for their password (linkAccount) in the same request
  const pending = new Map<string, PendingUser>();

  async function findOne<T>({ model, where }: { model: string; where: CleanedWhere[] }): Promise<T | null> {
    const q = equalities(model, where);
    if (model === "user") {
      if (only(q, "id")) {
        const account = await store.get(String(q.id));
        return (account ? userRow(account) : null) as T | null;
      }
      if (only(q, "username")) {
        const account = await store.find(String(q.username));
        return (account ? userRow(account) : null) as T | null;
      }
      if (only(q, "email")) {
        // A sign-up checking its (derived) address: a plain lookup, no copying from Atlas
        const account = await store.get(userId(usernameOfEmail(String(q.email))));
        return (account ? userRow(account) : null) as T | null;
      }
    }
    const credential = model === "account" ? credentialOf(q) : undefined;
    if (credential !== undefined) {
      const account = credential === null ? null : await store.get(credential);
      return (account ? accountRow(account) : null) as T | null;
    }
    if (model === "session" && only(q, "token")) {
      const session = await store.getSession(String(q.token));
      return (session ? sessionRow(session) : null) as T | null;
    }
    throw new UnsupportedQuery(`finding a ${model} by ${Object.keys(q).join(", ")}`);
  }

  return createAdapterFactory({
    config: {
      adapterId: "piano",
      adapterName: "Piano accounts",
      supportsJSON: false,
      supportsDates: true,
      supportsBooleans: true,
      transaction: false,
    },
    adapter: () => ({
      findOne,

      async create<T extends Record<string, unknown>>({
        model,
        data,
      }: {
        model: string;
        data: T;
      }): Promise<T> {
        const row: Row = data;
        if (model === "user") {
          const username = String(row.displayUsername ?? row.username);
          const uid = userId(username);
          pending.set(uid, { username, role: row.role as Role });
          return { ...data, id: uid };
        }
        if (model === "account" && row.providerId === "credential") {
          const uid = String(row.userId);
          const user = pending.get(uid);
          if (!user) throw new UnsupportedQuery("adding a password to an existing account");
          pending.delete(uid);
          const account = await store.register({ ...user, ...splitHash(String(row.password)) });
          if (account.uid !== uid)
            throw new Error("The accounts API and Better Auth disagree on the account's id");
          return accountRow(account) as T;
        }
        if (model === "session") {
          await store.putSession(toStoredSession(row));
          return data;
        }
        throw new UnsupportedQuery(`creating a ${model}`);
      },

      async findMany<T>({ model, where }: { model: string; where?: CleanedWhere[] }): Promise<T[]> {
        const q = equalities(model, where);
        const credential = model === "account" ? credentialOf(q) : undefined;
        if (credential !== undefined) {
          const account = credential === null ? null : await store.get(credential);
          return (account ? [accountRow(account)] : []) as T[];
        }
        if (model === "session" && only(q, "userId")) {
          return (await store.sessionsOf(String(q.userId))).map(sessionRow) as T[];
        }
        // A list by a unique field (Better Auth looks a row up this way before deleting or
        // updating it): at most the one findOne finds
        const one = await findOne<T>({ model, where: where ?? [] });
        return one ? [one] : [];
      },

      async update<T>({
        model,
        where,
        update,
      }: {
        model: string;
        where: CleanedWhere[];
        update: T;
      }): Promise<T | null> {
        const q = equalities(model, where);
        if (model === "session" && only(q, "token")) {
          const session = await store.getSession(String(q.token));
          if (!session) return null;
          const row = { ...sessionRow(session), ...(update as Row) };
          await store.putSession(toStoredSession(row));
          return row as T;
        }
        throw new UnsupportedQuery(`updating a ${model}`);
      },

      async updateMany({ model }) {
        throw new UnsupportedQuery(`updating ${model}s`);
      },

      async delete({ model, where }) {
        const q = equalities(model, where);
        if (model === "session" && only(q, "token")) return store.deleteSession(String(q.token));
        throw new UnsupportedQuery(`deleting a ${model}`);
      },

      async deleteMany({ model, where }) {
        const q = equalities(model, where);
        if (model === "session" && only(q, "userId")) return store.deleteSessionsOf(String(q.userId));
        throw new UnsupportedQuery(`deleting ${model}s`);
      },

      async count({ model }) {
        throw new UnsupportedQuery(`counting ${model}s`);
      },
    }),
  });
}
