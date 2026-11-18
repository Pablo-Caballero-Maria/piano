// Usernames, passwords, and the key the server gets instead of the password.
import { describe, expect, it } from "vitest";
import { checkCredentials, passwordKey } from "@/lib/credentials";

describe("credentials", () => {
  it("are checked before anything is sent", () => {
    expect(() => checkCredentials("ab", "secret1")).toThrow(/username/);
    expect(() => checkCredentials("ana maría", "secret1")).toThrow(/username/);
    expect(() => checkCredentials("ana", "short")).toThrow(/password/);
    expect(() => checkCredentials("ana.b-2_x", "secret1")).not.toThrow();
  });

  it("the password key is PBKDF2-SHA256 salted with the username (accounts depend on it)", async () => {
    // python: hashlib.pbkdf2_hmac("sha256", b"secret1", b"esp32-piano|ana", 100000).hex()
    const expected = "8dee89062086353d3f696f14cbb1e945912218ff33e71e89e91e95fcb693decc";
    expect(await passwordKey("ana", "secret1")).toBe(expected);
    expect(await passwordKey("ANA", "secret1")).toBe(expected); // usernames ignore case
  });
});
