// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hashPasswordKey, joinHash, splitHash, verifyPasswordKey } from "../../server/auth/password";
import { systemKeys } from "../../server/auth/keys";

/** bytes 0..31, the key tests/core/test_crypto.py uses for the same values. */
export const DATA_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

describe("system keys", () => {
  it("derive the same secrets and ids as the Python side", () => {
    const keys = systemKeys(DATA_KEY);
    expect(keys.secret).toBe("izoa-iHnFSD2LvP15ok0Q_fnBYNvnhZ3tfwRBHW9P5s");
    expect(keys.internalToken).toBe("dH0OfKcF2pKGQzDXGCl8MC7CH8Y88cn9ANPTavJb8c0");
    expect(keys.userId("Ana")).toBe("e8143115f7ea501aa876646c99350f6d");
    expect(keys.userId("ANA")).toBe(keys.userId("ana")); // usernames ignore case
  });

  it("refuse a key that isn't 32 bytes", () => {
    expect(() => systemKeys("c2hvcnQ=")).toThrow(/32 bytes/);
  });
});

describe("password hashes", () => {
  const KEY = "ab".repeat(32);

  it("are sha256(salt + key), as pianocore stored them before Better Auth", async () => {
    const stored = joinHash(
      "00".repeat(16),
      "bd4687d06cac5c2ba7518fea4586829e0c54dec858df32d471ef0925e0be0030",
    );
    expect(await verifyPasswordKey({ hash: stored, password: KEY })).toBe(true);
    expect(await verifyPasswordKey({ hash: stored, password: "cd".repeat(32) })).toBe(false);
  });

  it("get a fresh salt each time", async () => {
    const a = await hashPasswordKey(KEY);
    const b = await hashPasswordKey(KEY);
    expect(a).not.toBe(b);
    expect(splitHash(a).salt).toMatch(/^[0-9a-f]{32}$/);
    expect(splitHash(a).hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyPasswordKey({ hash: a, password: KEY })).toBe(true);
  });

  it("reject malformed stored hashes", async () => {
    expect(await verifyPasswordKey({ hash: "nonsense", password: KEY })).toBe(false);
    expect(await verifyPasswordKey({ hash: "00:11", password: KEY })).toBe(false);
  });
});
