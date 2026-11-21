# Security policy

## Supported versions

| Version | Supported |
| --- | :---: |
| 1.0.x (latest, `main`) | ✅ |
| < 1.0.0 | ❌ |

Only the latest version on `main` gets fixes: the teacher's PCs update themselves from it.

## Reporting a vulnerability

> [!IMPORTANT]
> Please **do not open a public issue** for a security problem.

Report it privately through GitHub: **[Report a vulnerability](https://github.com/Pablo-Caballero-Maria/piano/security/advisories/new)** (Security → Advisories →
*Report a vulnerability*). Include:

1. what is affected (file, endpoint, MQTT topic, firmware module…) and the version or commit;
2. how to reproduce it, step by step;
3. the impact you expect (what an attacker could read, change or break);
4. a fix or mitigation, if you have one in mind.

I will acknowledge the report within **7 days**, keep you informed while I work on it, and credit you
in the advisory and the [changelog](CHANGELOG.md) unless you prefer to stay anonymous.

## Scope

- Encryption of stored records (AES-256-GCM, HKDF-derived keys) and the session tokens.
- Authentication (PBKDF2 keys, HMAC-signed sessions) and anything that lets one account read or
  change another's melodies.
- MQTT: the broker ACLs and TLS between the teacher's PC and the boards.
- The self-update path (GitHub → teacher's PC → board) and the board's rollback.
- Secrets exposed in the repository (`PIANO_DATA_KEY`, `MONGODB_URI`, `ABLY_API_KEY`, DuckDNS
  tokens). `.env` must never be committed.

Out of scope: Bugs in the lesson flow or the Studio that have no security impact (open a normal issue).

## What the repository already does

- **Secret scanning** with push protection, so a commit containing a known token is blocked.
- **Dependabot** alerts and security updates for the Python (uv) and npm dependencies and the GitHub
  Actions, plus weekly version updates.
- **CodeQL** analysis of the Python, TypeScript and workflow code on every push, pull request and week.
