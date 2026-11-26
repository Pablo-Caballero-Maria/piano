// The environment of Better Auth's server on the teacher's PC (server/auth/env.ts).
import { describe, expect, it } from "vitest";
import { parseServerEnv } from "../../server/auth/env";

const ENV = {
  PIANO_DATA_KEY: "k",
  PIANO_ACCOUNTS_URL: "http://127.0.0.1:8080/internal/accounts",
  PIANO_AUTH_PORT: "4100",
};

describe("parseServerEnv", () => {
  it("reads the variables, with defaults", () => {
    expect(parseServerEnv(ENV)).toEqual({
      ...ENV,
      PIANO_AUTH_PORT: 4100,
      PIANO_PUBLIC_URL: "https://localhost",
      PIANO_AUTH_RATE_LIMIT: "on",
    });
    expect(parseServerEnv({ ...ENV, PIANO_PUBLIC_URL: " ", PIANO_AUTH_RATE_LIMIT: "off" })).toMatchObject({
      PIANO_PUBLIC_URL: "https://localhost",
      PIANO_AUTH_RATE_LIMIT: "off",
    });
  });

  it("names every problem at once", () => {
    expect(() => parseServerEnv({ PIANO_ACCOUNTS_URL: "not a url", PIANO_AUTH_PORT: "99999" })).toThrow(
      "PIANO_DATA_KEY is not set; PIANO_ACCOUNTS_URL must be a URL; PIANO_AUTH_PORT must be a port number",
    );
  });
});
