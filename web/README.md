# The website (Next.js)

The page everyone uses — teacher and students, on phones and PCs: the piano, the Studio (piano
roll), accounts and melodies, and the live class. It is a Next.js (App Router) project in
TypeScript, built as a **static export** (`npm run build` → `out/`): one page plus its scripts and
styles. Everything it shows is live (the class, the user's melodies), so nothing is rendered on a
server, and the same files are served two ways:

- **online by Vercel** (`../vercel.json`), next to the API function `../api/index.py`;
- **in the classroom by the teacher's PC** (`../fog/website.py`), with no internet needed. The PC
  builds it with the Node.js that uv installs (`uv run --group web npm …`): `../install.sh` the
  first time, and every update from GitHub after its tests pass (`../fog/updater.py`).

Both answer `/api/…` (the REST API, `../pianocore/api.py`); `GET /api/config` tells the page which
one it is talking to, and so whether the class goes over the PC's WebSocket or over Ably.

## Working on it

```sh
npm ci                          # once (Node ≥ 22.12; or prefix each command with `uv run --group web`)
uv run python -m fog demo       # in another terminal, from the repository root: the PC's app + a simulated board
npm run dev                     # http://localhost:3000, hot reload; /api and /ws go to the demo (PIANO_BACKEND)
npm run check                   # types, lint, formatting, unit and component tests
npm run test:coverage           # unit and component tests with coverage (coverage/)
npm run build                   # the static site, in out/ (the demo serves it on :8080)
npm run test:e2e                # end to end, in Chrome: builds nothing, so `npm run build` first
npm run format                  # Prettier
```

## Structure

```
src/
  app/          Next.js: the root layout (metadata, styles, icon sprite) and the one page
  components/   React components
    app/        PianoApp (the page: modes, computer keys, dialogs), Header, ClassBar, useLessonSync
    piano/      Piano mode, and what's sounding now
    keyboard/   the on-screen piano keyboard (drawn from a KeyboardController)
    studio/     the Studio's toolbar, view and melody list (the roll itself is studio/engine.ts)
    class/      the class panel (lesson, buzzer queue, people, the classroom PC)
    dialogs/    <dialog> wrapper, login, account, confirm
    ui/         icons, toasts
  hooks/        useStore / useSelect (stores → React), useMode (#piano / #studio)
  lib/          plain logic, no DOM: notes and the resultant frequency, melody text format,
                the playback timeline, undo history, keyboard layout and controller, stores
  services/     the outside world: the REST client and session (api.ts), the live class link
                (link/: WebSocket in the classroom, Ably online), the sound output (sound.ts)
  state/        the class as the page sees it (class-state.ts), toasts, dialog requests
  studio/       the piano roll engine: model, undo, playback, recording, following the teacher
                (engine.ts), its DOM (roll-view.ts), mouse/touch editing (gestures.ts), saving
                and opening melodies (library.ts)
  styles/       the stylesheet, by area
tests/          Vitest + Testing Library (jsdom), mirroring src/
e2e/            Playwright: real Chrome against the PC's app with a simulated board
```

How the pieces talk: logic lives in plain TypeScript classes that keep their state in a small
`Store` (`lib/store.ts`); components read stores with `useStore()`/`useSelect()` and call the
classes' methods. The services are one per page (`services/index.ts`). The piano roll is the one
part drawn outside React: hundreds of notes and a playhead that moves every frame are faster as
DOM the engine updates directly, inside an element React leaves alone.

## Conventions

- TypeScript `strict`; ESLint (Next.js's rules, React hooks, accessibility); Prettier, 110 columns.
- No secrets here: the page only knows its own origin. Passwords never leave the browser (it
  sends a PBKDF2 key, `lib/credentials.ts`); the session token is kept in localStorage.
- Ably's v3 browser SDK (required by the account's MAU pricing) isn't on npm: it's loaded from
  Ably's CDN only when online (`services/link/ably-sdk.ts`).
- Comments and docs explain _why_; user-facing text is English, like the rest of the page.
