# Changelog

All notable changes to ESP32 Piano are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Every version is tagged (`vX.Y.Z`) in the repository.

## [Unreleased]

## [1.2.0] - 2026-11-22

### Added

- **Accounts with [Better Auth](https://www.better-auth.com)**, on both servers, keeping piano's design. Better
  Auth (`web/server/auth/`) runs as a Node.js process next to the teacher's PC app — which starts it with uv's
  Node, restarts it if it stops and forwards `/api/auth/*` to it (`fog/auth_server.py`) — and as the Vercel
  function `api/auth.ts`. Its custom adapter keeps users, credentials and sessions through a new internal
  accounts API (`pianocore/accounts_api.py`, `pianocore/accounts.py`), so they stay sealed on the board or in
  Atlas with the same rules: unique usernames system-wide, pending accounts confirmed by the sync, people from
  other classes joining this one, and renamed accounts that keep signing in with their old name (the password
  picks the account). Better Auth's secret and the API's token are derived from the system key on both sides:
  no new setting. Existing accounts keep their password (the hash is the same); open sessions end once.
- Sessions are Better Auth's (30 days, renewed daily), stored by the server that made them: on the board for
  the PC, in Atlas's `sessions` collection (TTL index) for Vercel. The REST API and the live class check its
  signed token themselves (`pianocore/auth.py`). Better Auth limits sign-in attempts per phone; the PC passes on
  each phone's real address.
- **The page opens offline**: a Serwist service worker (`web/src/sw/`, `out/serwist/sw.js`, served with
  `Service-Worker-Allowed: /` by the PC and Vercel) precaches the build and keeps the page, so a phone that drops
  off the classroom WiFi can still play the piano and the Studio on its own sound. The API, Better Auth and the
  board's files are never cached.
- **A light theme**, now the default, next to the dark one: a button in the header, remembered and applied
  before the first paint. Every colour is a role defined for both themes in `globals.css` (still Tailwind's
  configuration only).
- **Skeletons** while the melodies list and the classroom PC's status load.
- Tests: the accounts and sessions, the accounts API, the Better Auth process and proxy (pytest, 121); Better
  Auth's flows, adapter, store and keys checked against the Python side's values, the theme and the service
  worker (Vitest, 132); the real Better Auth in the end-to-end tests, opening offline and the theme (Playwright, 7).
- `prettier-plugin-tailwindcss` in `web/`: Prettier keeps the Tailwind classes in their recommended order.
- [ty](https://docs.astral.sh/ty/) in the `dev` group: `uv run ty check` type-checks the Python code for
  Python 3.12, leaving out the MicroPython firmware (`esp32/`, `tests/board/`). It resolves imports like
  pytest does; not part of CI yet.

### Changed

- **Typed MongoDB documents**: every collection of `pianocore/mongo_repo.py` is a `Collection` of its document's
  `TypedDict` (users, melodies, aliases, meta, sessions), and the melodies' filter is typed too.
- The REST API's `GET /api/auth/me` is now `GET /api/me` (`/api/auth/*` is Better Auth's).
- The website is styled with **Tailwind CSS v4** only: every style is a utility class on its element,
  with no stylesheet of its own (`web/src/app/globals.css` just configures Tailwind: the theme and the
  screen-size variants). It is compiled by `@tailwindcss/turbopack`, declared in `next.config.ts` as in
  the other websites. The page looks the same: compared screenshot by screenshot
  on a desktop, a phone and a phone in landscape.
- The website's icons are `lucide-react` (1.75.0, the version the other websites use) instead of its own
  SVG sprite; the play, stop, back-to-start and record icons stay filled.

### Removed

- `POST /api/auth/register` and `/api/auth/login`, and the HMAC session tokens (`make_token`, `read_token`):
  Better Auth replaces them.

## [1.1.1] - 2026-11-21

### Changed

- The classroom privacy test also checks that neither telemetry library is loaded at all: on Vercel, their
  scripts can be served from a same-origin path instead of `/_vercel/…`, which the previous check alone wouldn't catch.

## [1.1.0] - 2026-11-21

### Added

- **Vercel Web Analytics** (page views, cookieless) and **Speed Insights** (Core Web Vitals of real
  visits) on the website Vercel serves. Only Vercel's build includes them (`VERCEL=1`): the teacher's PC
  builds the classroom's copy without them.
- An end-to-end test (`web/e2e/privacy.spec.ts`) that checks that the classroom page only talks to the
  teacher's PC: no request to Vercel or anywhere else. 197 automated tests in all.

## [1.0.0] - 2026-11-21

### Added

- Continuous integration with GitHub Actions on every push and pull request: Ruff (lint and
  formatting), pytest with coverage against a real MongoDB, the website's types, ESLint, Prettier,
  Vitest with coverage and static export, and the Playwright end-to-end tests. Coverage is summarised
  on every run and published as README badges.
- `pytest-cov` and `@vitest/coverage-v8`; `npm run test:coverage` in `web/`.
- Security: CodeQL analysis (Python, TypeScript and the workflows), Dependabot (uv, npm and GitHub
  Actions), secret scanning with push protection, and a [security policy](SECURITY.md) with private
  advisories.
- [MIT licence](LICENSE), [code of conduct](CODE_OF_CONDUCT.md), [CITATION.cff](CITATION.cff), issue
  templates (bug, feature, classroom or hardware problem) and a pull request template.
- A [wiki](https://github.com/Pablo-Caballero-Maria/piano/wiki) on the architecture, setting up a
  classroom, the board, security and sync, the website and testing.

### Changed

- The README, reorganised with badges, a table of contents, diagrams and screenshots.

## [0.4.0] - 2026-11-19

### Added

- The website rewritten in **Next.js + TypeScript** (static export) instead of one HTML page, with
  Vitest and Playwright tests.
- `install.sh`: one script that sets up a new teacher's PC and its board, asking what it needs; and
  `deploy/uninstall.sh` to undo `deploy/setup.sh` on a PC.
- The project report (`docs/memoria/memoria.pdf`, in Spanish) and its diagrams.

### Changed

- Fixes from the first real installation with the board, two phones and a phone's hotspot as the
  classroom router.
- The page's mode follows the address (`#piano` / `#studio`).

## [0.3.0] - 2026-11-17

### Added

- The **fog architecture**: the teacher's PC serves the website, runs the live class and the buzzer
  queue, and drives the board over MQTT with TLS (Mosquitto); it syncs the board with MongoDB Atlas and
  relays lessons to Ably for students at home.
- Self-updating from GitHub over HTTPS after the new version's tests pass; the DuckDNS name follows the
  PC's address every 30 s.

### Changed

- Vercel deploys from the repository root; the API answers configuration errors clearly.
- Browser: Ably's v3 device SDK.
- The class panel lists students following from home as soon as they join.

## [0.2.0] - 2026-11-04

### Added

- The **Studio** (a piano-roll editor), user accounts and Vercel functions.

### Changed

- Accounts and melodies are stored on the ESP32 instead of MongoDB Atlas.

## [0.1.0] - 2026-11-03

### Added

- First version: a web piano that plays its notes on an ESP32 buzzer over Bluetooth.

[Unreleased]: https://github.com/Pablo-Caballero-Maria/piano/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/Pablo-Caballero-Maria/piano/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/Pablo-Caballero-Maria/piano/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/Pablo-Caballero-Maria/piano/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Pablo-Caballero-Maria/piano/compare/v0.4.0...v1.0.0
[0.4.0]: https://github.com/Pablo-Caballero-Maria/piano/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Pablo-Caballero-Maria/piano/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Pablo-Caballero-Maria/piano/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Pablo-Caballero-Maria/piano/releases/tag/v0.1.0
