# Changelog

All notable changes to ESP32 Piano are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Every version is tagged (`vX.Y.Z`) in the repository.

## [Unreleased]

### Changed

- The website is styled with **Tailwind CSS v4**: utility classes on the elements, and
  `web/src/app/globals.css` for what they don't express (the theme, the buttons' and fields' defaults,
  the keyframes, the piano roll's grid lines). It is compiled by `@tailwindcss/turbopack`, declared in
  `next.config.ts` as in the other websites. The page looks the same: compared screenshot by screenshot
  on a desktop, a phone and a phone in landscape.

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

[Unreleased]: https://github.com/Pablo-Caballero-Maria/piano/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/Pablo-Caballero-Maria/piano/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/Pablo-Caballero-Maria/piano/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Pablo-Caballero-Maria/piano/compare/v0.4.0...v1.0.0
[0.4.0]: https://github.com/Pablo-Caballero-Maria/piano/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Pablo-Caballero-Maria/piano/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Pablo-Caballero-Maria/piano/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Pablo-Caballero-Maria/piano/releases/tag/v0.1.0
