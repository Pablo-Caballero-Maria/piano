# Piano lessons with an ESP32 buzzer

A web piano for piano lessons. The teacher and every student use their phone (or PC). The
teacher plays — on the piano or in the **Studio**, a piano roll like FL Studio's — and the notes
sound on a buzzer driven by an ESP32 in the classroom while every student sees them live on their
own phone. Everyone can also practise alone (piano and studio), save melodies privately or share
them publicly, and follow lessons from home over the internet.

```
 phones (teacher, students)  ── HTTPS + WebSocket ──►  teacher's PC  ── MQTT/TLS ──►  ESP32 + buzzer
   on the classroom router                              (fog node)                   (classroom router)
                                                           │  when online
                       GitHub (code) ◄── updates ──────────┤
                       MongoDB Atlas ◄── sync ─────────────┤
                       Ably (live lessons) ◄── relay ──────┘
 phones at home  ── HTTPS ──►  Vercel (same website + API on Atlas)  ── Ably ──►  live lessons
```

- **The teacher's PC** is the *fog node*: it serves the website to the phones in the classroom
  (nginx, HTTPS for `piano-esp32.duckdns.org`), runs the live class, and drives the board over
  MQTT. It keeps **no database**: accounts and melodies live on the board. Whenever it has
  internet it updates itself and the board from GitHub (after testing the new version), syncs the
  board with MongoDB Atlas, and relays the lesson to Ably for students at home.
- **The board** (ESP32, MicroPython) joins the classroom WiFi, plays the buzzer and stores the
  class's accounts and melodies — encrypted: it can't read them.
- **Vercel** serves the same website for everyone, with the same API on Atlas, plus live lessons
  over the internet with Ably.
- Everything is **encrypted in transit** (HTTPS, WSS, MQTT over TLS) and **at rest** (every stored
  record is sealed with AES-256-GCM using a system key that only the teacher PCs and Vercel hold).

```
pianocore/   shared by the PC and Vercel: crypto, models, auth, repositories (board / Atlas), the
             rules (service.py), board⇄Atlas sync, the REST API, Ably helpers
fog/         the teacher's PC: app.py (FastAPI), classroom.py (live class), buzzer_queue.py,
             board.py (MQTT link), sync_service.py, updater.py (GitHub), internet.py (DuckDNS),
             ably_bridge.py, simboard.py (simulated board), settings.py (.env); `python -m fog`
esp32/       the board's firmware: main.py (boot, rollback, update mode), app.py, mqtt.py (own
             MQTT client), kv.py (encrypted-blob store), tone.py, config.py, updater.py, ota.py
api/         the Vercel function (index.py): the API on Atlas, Ably tokens, live lessons
web/public/  the website (plain ES modules, no build): js/link.js (class link: WebSocket or
             Ably), js/class.js (lessons, buzzer queue, students), js/studio.js, js/api.js…
deploy/      nginx, Mosquitto, certbot (DuckDNS DNS challenge) and systemd setup: `sudo deploy/setup.sh`
tools/       board.py (install the board over USB), fake_board.py (pretend board), sim/ (lets the
             board's MicroPython code run on CPython)
tests/       core/, fog/, board/ (also run ON the board), web/ (node), integration (real broker)
buzzer.py    the very first demo (scales and tunes, no network), run with mpremote
```

## A class

1. Everyone joins the classroom WiFi (the router) and opens **https://piano-esp32.duckdns.org**.
2. **Create an account** (Log in → Create account), choosing **student** or **teacher**. The
   password never leaves the phone (it sends a PBKDF2 key). An account made on any classroom PC or
   online works everywhere once the PC has synced.
3. The class is everyone connected to the teacher's PC. The **Class** button opens the class panel.
4. The teacher presses **Start the lesson** (in the mode they're in: piano or studio):
   - piano: every student sees the teacher's notes on their keyboard (amber marks) and in the bar;
   - studio: the students' studio shows the teacher's piano roll, read-only and in step with the
     teacher's playback; their own melody comes back when the lesson ends ("Back to my melody");
   - the buzzer plays the teacher; the teacher can **Give buzzer** to a student and take it back.
5. The teacher's panel lists everyone: their mode, what they're playing, what they're editing
   (and students following from home, marked "from home").
6. Without a lesson, anyone can **Ask for the buzzer**: they queue, first come first served, and
   the first one plays. Teachers administer the queue (move up, remove, **Next**).
7. Melodies (Studio → Save) are **private** (lock) or **public** (globe): everyone can see and edit
   a public melody; only its owner deletes it or makes it private. "Melodies" has *Mine* and
   *Public* tabs; the list says who made each and who edited it last.

Online (Vercel, with internet): the same website and accounts; the Class panel lists **live
lessons** (online ones, and classroom lessons relayed by their PC) to join; teachers can give a
lesson from home. There's no buzzer online.

The piano keyboard: tap/click, slide for a glissando, or computer keys `A W S E D F T G Y H U J K
O L P` (`Z`/`X` octave). The Studio: draw/erase notes, snap, BPM, zoom, undo/redo, loop,
metronome, record from the piano; overlapping notes play their **resultant frequency** (the mean:
sin a + sin b = 2·cos((a−b)/2)·sin((a+b)/2)), because the buzzer has one voice. Details are in the
code comments of `web/public/js/studio.js`.

## Setting up the teacher's PC

On the PC (Arch Linux here; any Linux with systemd works):

```sh
git clone git@github.com:Pablo-Caballero-Maria/piano.git && cd piano
uv sync                                   # Python 3.12+, all dependencies
cp .env.example .env && chmod 600 .env    # then fill it in (see below)
sudo pacman -S nginx mosquitto certbot curl
sudo deploy/setup.sh                      # certificate, Mosquitto, nginx, the piano-fog service
uv run python -m fog check                # checks the settings and what's reachable
```

`.env` (never committed: the repository is public). **PIANO_DATA_KEY**: create it once with
`uv run python -m fog keygen` and use the same one on every teacher PC and on Vercel, or they
can't read each other's data (and keep it: data sealed with a lost key is gone). Also the DuckDNS
name and token, the classroom WiFi (for the board), MONGODB_URI and ABLY_API_KEY (optional:
without them the class works offline only). `setup.sh` generates the MQTT passwords.

What `deploy/setup.sh` does: points `piano-esp32.duckdns.org` at the PC's **classroom** address
(phones reach it on the router); gets a Let's Encrypt certificate with a DNS challenge through
DuckDNS (works on a private address) and enables its renewal; configures Mosquitto (port 1883 on
localhost for the app, 8883 with TLS for the boards, a user per board that may only use its own
topics) and nginx (HTTPS on 443 in front of the app, which serves everything: the repository is in
a home folder nginx can't read); installs the app as the `piano-fog` service (restarts on failure
and after updates). Logs: `journalctl -u piano-fog -f`.

The PC keeps the DuckDNS record on its current classroom address. If the router blocks public DNS
answers that point at private addresses ("DNS rebinding protection"), add a local DNS entry on the
router, or set `PIANO_SERVER_IP` for the board.

### Trying it without the hardware

- `uv run python -m fog demo` — the whole PC app with a **simulated board** (the board's real
  storage code, in-process), on http://localhost:8080. No broker, nginx or .env needed. The
  buzzer's notes are logged. Open it in two browser profiles to be teacher and student.
- `uv run tools/fake_board.py` — a pretend board for a real setup: the board's firmware on this
  laptop, connected to Mosquitto (127.0.0.1:1883, or `--tls` on 8883 like the real one), playing
  the buzzer on the laptop's speaker (pacat).

## The board

Wiring: the buzzer module's **S → D33 (GPIO 33)**, **− → GND**, middle pin → **3V3**. The board
sits loosely in the breadboard: press it in (or wire straight to its pins), or the buzzer goes
silent after a note or two (History 8).

```sh
uv run tools/board.py setup     # USB: firmware + its tests + /config.json from .env, runs the tests, restarts
uv run tools/board.py test      # the board's test suite, on the board
uv run tools/board.py log       # what it prints (Ctrl-] to quit)
```

After `setup` the board joins the classroom WiFi, sets its clock (NTP, or the Date header of the
PC's port 80 when the classroom has no internet: TLS checks certificate dates), connects to the
PC's broker over TLS (checking the certificate against Let's Encrypt's roots in `esp32/ca.pem`),
and chirps (C6-E6-G6 at start, G6-C7 connected, C7-G6 lost). From then on **the PC updates it**:
when a new version changes the board's files, the PC sends `piano/<id>/ota`; the board restarts
into update mode (only `ota.py` runs, so TLS has memory), downloads the changed files from
`https://<PC>/board/<sha>/…`, checks each one's git hash, runs **its own test suite** on the new
code, and installs it only if every test passes. A new version that crashes 3 times before
reaching the PC, or an install cut short by a power loss, is rolled back (`esp32/main.py`).

Memory: MicroPython 1.29's Python heap starts at 56 KB and can only grow by doubling, taking C
memory WiFi and TLS need; compiling big `.py` files on the board fragments it. So the firmware is
small (no Bluetooth, no web server: the PC does that) and stores only encrypted blobs.

## Online: Vercel and Ably

Vercel serves `web/public` and the function `api/index.py` (FastAPI): the same REST API on Atlas,
`/api/ably/token` (signed Ably token requests: teachers may publish on their own lesson channel
`class:<name>`, everyone may follow lessons and enter their presence) and `/api/live`. It deploys
from GitHub on every push to `main`.

Ably: the app **piano-esp32** has a key **piano-server** (publish, subscribe, presence, channel
metadata) for the servers; it's in the PCs' `.env` (ABLY_API_KEY). The app requires *identified*
clients on lesson channels, so the PC's REST calls identify as the lesson's teacher
(`X-Ably-ClientId`) and browsers get tokens with their username as clientId.

**Pending (Vercel dashboard):** in the project settings, set **Root Directory** to empty (the
repository root: the root `vercel.json` then applies; afterwards delete `web/vercel.json`) and add
the environment variables `PIANO_DATA_KEY` (the same as the PCs'), `MONGODB_URI` and
`ABLY_API_KEY` (all three are in `.env`). Until then Vercel serves `web/` statically (the page works
as a standalone piano; accounts and online lessons need the API).

## Development

```sh
uv run pytest -q                     # Python: core, PC, board code (on CPython), integration
node --test tests/web/               # browser code
uv run ruff format . && uv run ruff check .
PIANO_TEST_MONGODB_URI=… uv run pytest tests/core/test_mongo.py   # against a real MongoDB (throwaway db)
```

- `tests/board/` is MicroPython-compatible: pytest runs it here, `tests/board/testrunner.py` runs it
  on the board (and the board runs it before installing an update).
- `tests/test_integration.py` runs the board's firmware (its own MQTT client) and the PC's link
  (aiomqtt) through a real broker (amqtt): storage, buzzer, last will, keeping a new version.
- `tests/fog/test_app.py` drives the PC app end to end (REST, WebSocket) with the board's real
  storage code; `tests/fog/test_updater.py` runs self-updates against throwaway git repos.
- FastAPI modules with dependencies defined inside functions must not use
  `from __future__ import annotations` (FastAPI then can't resolve them: 422 errors).

## Security

- In transit: HTTPS/WSS (Let's Encrypt) for phones, MQTT over TLS for the board (certificate
  checked; Mosquitto users and per-board topic ACLs), TLS to Atlas, Ably, GitHub and DuckDNS.
- At rest: every record on a board or in Atlas is AES-256-GCM sealed (`pianocore/crypto.py`), bound
  to its key; usernames are stored as keyed hashes. Only ids, the owner's hashed id, the public
  flag and update times are in the clear (queries need them). Passwords: PBKDF2 in the browser,
  salted SHA-256 on the server. Sessions: HMAC-signed tokens (30 days).
- Secrets live only in `.env` (PC) and Vercel's settings. Board updates are verified (TLS + git
  hashes + tests). Anyone may sign up as a teacher (as decided); a teacher-code could be added.

## Protocols (details in each module's docstring)

- REST API: `pianocore/api.py` (+ `fog/app.py`, `api/index.py`).
- Live class WebSocket messages: `fog/classroom.py`; browser side `web/public/js/link.js`.
- MQTT topics PC ⇄ board: `fog/board.py`, `esp32/app.py`; storage requests (binary): `esp32/kv.py`.
- Stored records and keys: `pianocore/kv_repo.py`, `pianocore/mongo_repo.py`; sync: `pianocore/sync.py`.
- Ably channels and messages: `pianocore/ably.py`. Board updates: `fog/updater.py`, `esp32/ota.py`.

## Troubleshooting

- **The page doesn't load on a phone**: is it on the classroom router? Does
  `piano-esp32.duckdns.org` resolve to the PC there (`uv run python -m fog check` prints the LAN
  IP)? Is nginx running (`systemctl status nginx`)?
- **"board offline"**: is the board's chirp G6-C7 heard? `uv run tools/board.py log` shows what it
  does (WiFi, clock, MQTT errors). Check `journalctl -u mosquitto`.
- **No /dev/ttyUSB0 but `journalctl -k` shows the CP2102 (`10c4:ea60`)**: the kernel was upgraded
  without a reboot (its `cp210x` module is gone): reboot (or `insmod` it from the cached package).
- **`mpremote` can't open /dev/ttyUSB0**: the user must be in `uucp`; nothing else may hold the port.
- **"could not enter raw repl" right after a reset**: the board was still booting; run it again.

---

## Project context (for the next Claude Code session: read this first)

### Goal and decisions
A class project, redesigned on 2026-11-17 at the user's request into **piano lessons with a fog
node** (see the top of this file). The user's answers to the design questions: PC ⇄ board over
**MQTT**; phones, PC and board on **a router in the classroom** (eduroam isolates clients);
**DuckDNS `piano-esp32.duckdns.org` + Let's Encrypt** (DNS challenge; the record points at the PC's
LAN IP); **nginx + Mosquitto** set up by a sudo script; the class = **whoever is connected to the
PC**; sign-up chooses **student/teacher**; buzzer: **the live teacher, who can hand it to a student;
otherwise a first-come queue administered by the teacher**; melodies **private or public**
(public: everyone sees and edits); each board keeps **its class + public melodies**, Atlas
everything, **newest edit wins** (editor recorded), usernames unique system-wide (an account made
offline whose name was taken meanwhile is renamed, its old name still logs in); **Vercel + Ably**
for online lessons and relaying classroom lessons; **one system key** on PCs and Vercel. The
user said the Claude in Chrome extension may be used to set up Ably and Vercel's variables.

### Status (2026-11-17)
| Part | Status |
|---|---|
| Shared core, PC app, board firmware, Vercel function, website | ✅ Written and tested: 74 Python + 12 JS tests; MongoRepo checked against the real Atlas cluster |
| Website in a real browser | ✅ Headless Chrome against `python -m fog demo`: sign-up as teacher/student, piano lesson (notes reach the buzzer and the student's keyboard), studio lesson (student follows read-only, in step), buzzer queue, public melody edited by another user, phone layout |
| Board ⇄ PC over MQTT | ✅ Firmware's MQTT client + aiomqtt through amqtt (tests) and through Mosquitto with the deploy ACL (manual check) |
| `deploy/setup.sh` | 🟡 Written, syntax-checked; not run yet (needs sudo: the user runs it) |
| Real board with the new firmware | ⬜ The board is back with the teacher. It still has the OLD files and **`main.py` renamed to `main_off.py`** (from a memory test): `uv run tools/board.py setup` fixes it |
| Ably | ✅ Key `piano-server` created; the PC's relay publishes and reads presence against the real Ably |
| Vercel (root dir, env vars) | ⬜ The settings page wouldn't load in the automated Chrome; secrets must be typed by the user anyway |

### Hardware
- ESP32 dev board, **MicroPython v1.29.0** (`ESP32_GENERIC`), borrowed from the teacher; its own
  `boot.py` and `blink.py` must stay. USB serial `/dev/ttyUSB0` (CP2102). 4 MB flash (~2 MB free).
  The firmware has **no MQTT library** (hence `esp32/mqtt.py`), `deflate` can't compress, and
  `requests` doesn't verify TLS (hence `esp32/ota.py`'s own GET).
- Buzzer: passive 3-pin magnetic module (~20-40 Ω coil): S → D33, − → GND, middle → 3V3; works at
  50 % duty (`VOLUME = 0.5`; 100 % only clicks). On-board LED on GPIO 2.
- The board sits loosely in the breadboard: D33/GND lose contact with any vibration.
- The user's phone: Xiaomi Redmi 12, Android, Chrome.

### Laptop (the teacher's PC for now: Arch Linux, fish, zen kernel, Chrome 156)
- `uv` project (`pyproject.toml`); `mpremote` is a dev dependency (`uv run mpremote …`).
- Serial: `/dev/ttyUSB0` is `root:uucp` 660 and the user is in `uucp`.
- nginx, certbot, mosquitto installed (services not enabled until `setup.sh`). Home is mode 700.
- Only WiFi (eduroam) — joining another network from the laptop drops the session; there's an
  Ethernet port. The MT7920 card also does Bluetooth (no longer used).
- Chrome can run headless with `--remote-debugging-port` for UI tests when the Claude in Chrome
  extension isn't connected.

### History
1. **2026-10-28**: `buzzer.py` played tunes on the board (PWM, `VOLUME = 0.5`).
2. **Bluetooth piano**: the page wrote frequencies to a BLE characteristic of the ESP32
   (MicroPython `bluetooth`, one write in flight, newest note wins); glissando, computer keys by
   physical position, device sound. Deployed on Vercel. Android BLE latency ~50 ms per note.
3. **2026-11-03** (board in class): the firmware ran unchanged; "no sound" was bad contacts (a loose
   GND wire, then the board loose in the breadboard), diagnosed with the D33 pull-up trick.
4. **2026-11-04**: Studio (piano roll, playback, recording, resultant frequency), accounts and
   melodies first on Atlas (Vercel functions), then — at the user's request — on the board itself
   (btree over BLE). Tested from the phone.
5. **2026-11-17**: the board hosted the website itself on its own WiFi (worked from the phone, with
   Chrome's insecure-origin flag for Web Bluetooth). Adding WiFi configuration and self-update on
   the board ran out of RAM (see "The board": heap doubling); `mpy-cross` was blocked; the user
   discarded that work and redesigned the project into the current fog-node architecture
   (decisions above). Built the shared core, the PC app, the new firmware (MQTT, encrypted store,
   verified updates with on-board tests and rollback), the Vercel function, the class UI, deploy
   scripts, and tests at every level; found and fixed while testing: a never-called
   `mark_good()` (good updates would have been rolled back), a 32-bit overflow in the store's
   free-space answer on a big disk, and a spurious "your turn" toast for the live teacher.

### Not verified yet
- `deploy/setup.sh` end to end (certificate via DuckDNS, nginx and Mosquitto with TLS, the service).
- The new firmware on the real board (WiFi, clock, MQTT/TLS with Let's Encrypt, memory headroom,
  an update over WiFi with its on-board tests).
- Vercel with the API and Ably; online lessons and the classroom relay with a real Ably key.
- Phones on the classroom router (DNS rebinding protection on the router?).
