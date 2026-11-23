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

Both answer `/api/…` (the REST API, `../pianocore/api.py`, and Better Auth at `/api/auth/*`); `GET
/api/config` tells the page which one it is talking to, and so whether the class goes over the PC's
WebSocket or over Ably.

This folder also holds **Better Auth's server** (`server/auth/`), which isn't part of the page: the PC runs it
as a Node process (`npm run build` bundles it into `out/_server/auth.mjs`, which the PC never serves) and Vercel
as the function `../api/auth.ts`. Its store is the Python side's accounts API (see the main README,
_Accounts_).

## Working on it

```sh
npm ci                          # once (Node ≥ 22.12; or prefix each command with `uv run --group web`)
uv run python -m fog demo       # in another terminal, from the repository root: the PC's app + a simulated board
npm run dev                     # http://localhost:3000, hot reload; /api and /ws go to the demo (PIANO_BACKEND)
npm run check                   # types, lint, formatting, unit and component tests
npm run test:coverage           # unit and component tests with coverage (coverage/)
npm run build                   # the static site, in out/ (the demo serves it on :8080), and Better
                                #   Auth's server for the PC, out/_server/auth.mjs
npm run test:e2e                # end to end, in Chrome: builds nothing, so `npm run build` first
npm run format                  # Prettier
```

## Structure

```
src/
  app/          Next.js: the root layout (metadata, the theme script, the service worker), the one
                page, the service worker's route (serwist/), and globals.css: only Tailwind CSS v4's
                configuration (both themes' colours, fonts and animation; screen sizes and dark)
  components/   React components
    app/        PianoApp (the page: modes, computer keys, dialogs), Header, ClassBar, useLessonSync
    piano/      Piano mode, and what's sounding now
    keyboard/   the on-screen piano keyboard (drawn from a KeyboardController)
    studio/     the Studio's toolbar, view and melody list (the roll itself is studio/engine.ts)
    class/      the class panel (lesson, buzzer queue, people, the classroom PC)
    dialogs/    <dialog> wrapper, login, account, confirm
    ui/         toasts, the theme button, skeletons, the service worker's registration, and
                button() / field() and the other Tailwind classes several components share
                (classes.ts)
  hooks/        useStore / useSelect (stores → React), useMode (#piano / #studio), useTheme
  lib/          plain logic, no DOM: notes and the resultant frequency, melody text format,
                the playback timeline, undo history, keyboard layout and controller, stores, the theme
  services/     the outside world: the REST client and session (api.ts), accounts through Better
                Auth's client (auth.ts), the live class link
                (link/: WebSocket in the classroom, Ably online), the sound output (sound.ts)
  state/        the class as the page sees it (class-state.ts), toasts, dialog requests
  studio/       the piano roll engine: model, undo, playback, recording, following the teacher
                (engine.ts), its DOM (roll-view.ts), mouse/touch editing (gestures.ts), saving
                and opening melodies (library.ts)
  sw/           the service worker (worker.ts): the page offline; what it never caches
server/auth/    Better Auth's server: configuration (auth.ts), the adapter onto piano's accounts
                (adapter.ts), the accounts API client (store.ts), keys and password hashing, and its
                entry points for the PC (server.ts) and Vercel (vercel.ts)
scripts/        build-auth-server.mjs: bundles server/auth for the PC
tests/          Vitest + Testing Library (jsdom), mirroring src/; server/ in Node
e2e/            Playwright: real Chrome against the PC's app with a simulated board
```

How the pieces talk: logic lives in plain TypeScript classes that keep their state in a small
`Store` (`lib/store.ts`); components read stores with `useStore()`/`useSelect()` and call the
classes' methods. The services are one per page (`services/index.ts`). The piano roll is the one
part drawn outside React: hundreds of notes and a playhead that moves every frame are faster as
DOM the engine updates directly, inside an element React leaves alone.

## Conventions

- TypeScript `strict`; ESLint (Next.js's rules, React hooks, accessibility); Prettier, 110 columns.
- No CSS of our own: every style is a Tailwind utility class on its element (buttons and fields
  through `button()` / `field()`, the piano roll's in `studio/roll-view.ts`); `globals.css` only
  configures Tailwind. Class names without styles (`.key`, `.roll`, `.note`, `.sel`…) are what
  tests and the pointer code look for.
- No secrets here: the page only knows its own origin (Better Auth's server derives its secret from
  the system key at run time). Passwords never leave the browser (it sends a PBKDF2 key,
  `lib/credentials.ts`); Better Auth's signed session token is kept in localStorage and sent as a
  bearer token.
- Two themes: light (the default) and dark, from the header's button; `globals.css` defines the light
  colours in `@theme` and the dark ones under `@variant dark`, so components only name roles
  (`bg-panel`, `text-muted`…). The piano keys look the same in both.
- The page opens offline once visited (a Serwist service worker; the API, Better Auth and the board's
  files are never cached), and shows skeletons while melodies and the PC's status load.
- Icons are `lucide-react` components (inline SVG, the same set as the other websites).
- Ably's v3 browser SDK (required by the account's MAU pricing) isn't on npm: it's loaded from
  Ably's CDN only when online (`services/link/ably-sdk.ts`).
- Comments and docs explain _why_; user-facing text is English, like the rest of the page.
