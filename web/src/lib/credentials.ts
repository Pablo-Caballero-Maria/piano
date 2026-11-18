/**
 * Usernames and passwords. The password never leaves the browser: the server gets a key derived
 * from it (PBKDF2), and checks that (pianocore/auth.py).
 */

const USERNAME = /^[A-Za-z0-9_.-]{3,32}$/;
export const MIN_PASSWORD = 6;

/** Throws an Error with a message for the user if the username or password can't be valid. */
export function checkCredentials(username: string, password: string): void {
  if (!USERNAME.test(username)) throw new Error("The username must be 3-32 letters, digits, _ . or -");
  if (password.length < MIN_PASSWORD)
    throw new Error(`The password must be at least ${MIN_PASSWORD} characters`);
}

/**
 * What the server gets instead of the password: PBKDF2-SHA256(password), salted with the
 * username and stretched 100 000 times, as 64 hex digits. Changing it would lock everyone out.
 */
export async function passwordKey(username: string, password: string): Promise<string> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: enc.encode(`esp32-piano|${username.toLowerCase()}`),
      iterations: 100000,
    },
    base,
    256,
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
