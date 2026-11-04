# ESP32 Bluetooth Piano

Play a piano in the browser (PC or phone); the notes go over Bluetooth (BLE) to an
ESP32, which plays them on a buzzer in real time. A **Studio** mode (a piano roll like
FL Studio's) lets you compose melodies, play them on the buzzer, and save them to your
own account.

**Live site: https://piano-web-virid.vercel.app/**. Every push to `main` on GitHub deploys it.

```
pyproject.toml       uv project: pins mpremote (the tool that talks to the board over USB)
buzzer.py            first demo: beeps, scale, siren, Twinkle, Ode to Joy (no Bluetooth). Works.
esp32/main.py        ESP32 firmware: BLE receiver -> buzzer on GPIO 33. Installed on the board as :main.py (auto-starts).
tools/fake_esp32.py  laptop pretends to be the ESP32 (test the site from a phone, no board needed)
web/                 the website = the Vercel project's Root Directory
  public/            static site (no build step): index.html, css/app.css, js/*.js (ES modules)
    js/main.js       page wiring: header, Piano/Studio modes, computer keys
    js/keyboard.js   on-screen piano (touch, glissando, computer keys), used by both modes
    js/studio.js     Studio: piano roll editor, playback, recording, save/open
    js/notes.js      note names, frequencies, resultant frequency of overlapping notes
    js/ble.js        Web Bluetooth link to the ESP32
    js/sound.js      the single output: ESP32 + optional device sound, metronome
    js/api.js, ui.js backend calls / login state; dialogs and toasts
  api/               Vercel serverless functions (Node.js): accounts and melodies
  lib/               code shared by the functions: MongoDB connection, auth, validation
  dev-server.mjs     local stand-in for Vercel (`npm run dev`)
  vercel.json        Vercel config: serve public/, no framework
  .env.local         MONGODB_URI for local runs (NOT in git; the repo is public)
README.md            this file: instructions + full project context/log (read it first)
```

## Use it

### Setup (laptop)

You need [uv](https://docs.astral.sh/uv/) and an ESP32 flashed with
[MicroPython](https://micropython.org/download/ESP32_GENERIC/).

```sh
git clone git@github.com:Pablo-Caballero-Maria/piano.git && cd piano
uv sync            # creates .venv with mpremote
```

The website has no build step (plain HTML/CSS/JS modules). The backend needs Node.js 20+;
see "Run the website locally" below.

### Put the firmware on the ESP32

Wire it the same as before, with the buzzer's **S** pin on **D33**.

```sh
# Quick test (stops when you press Ctrl-C or unplug); prints "Connected"/"Disconnected":
uv run mpremote connect /dev/ttyUSB0 run esp32/main.py

# Or install it so it starts by itself whenever the board gets power
# (works from a phone charger / power bank, no laptop needed):
uv run mpremote connect /dev/ttyUSB0 cp esp32/main.py :main.py + reset

# Remove it again (back to a blank board):
uv run mpremote connect /dev/ttyUSB0 rm :main.py
```

When it starts, the buzzer plays a short rising "ready" chirp (C6-E6-G6) and the board
advertises as **ESP32-Piano**.

### Play

1. Open the live site in **Chrome** (Android, Windows, macOS, Linux) or **Edge**.
   iPhone/iPad: Safari can't do Bluetooth; use the free **Bluefy** browser app.
   On Android, Bluetooth (and sometimes Location) must be turned on.
2. Press **Connect ESP32** and pick **ESP32-Piano**. The ESP32 chirps up (G6→C7), and its LED
   lights up if the board has one on GPIO 2. On disconnect it chirps down.
3. Play: tap/click keys, slide your finger across keys, or use the computer keyboard
   (`A W S E D F T G Y H U J K O L P`, `Z`/`X` = octave down/up).

The buzzer can only play one note at a time: the last key pressed wins, and when you
let it go, the previous key you're still holding plays again.

The speaker button in the header ("device sound") also plays the notes on the phone/PC.

### Studio (compose melodies)

Open the **Studio** tab (or `…/#studio`). It's a piano roll: **X axis = time** (bars and beats;
the clock shows the time in seconds), **Y axis = pitch**. Each row is labelled with its note
and frequency in Hz, from C1 (33 Hz) to B8 (7902 Hz).

- **Draw tool** (pencil): click an empty spot to add a note (it gets the length of the last note
  you touched), drag a note to move it, and drag its right edge to resize it. Right-click deletes.
  Shift/Ctrl-click adds notes to the selection, Shift/Ctrl-drag selects with a box, and Ctrl+A
  selects all. Delete removes the selection, and the arrow keys move it (Shift+↑/↓ = an octave).
  On a phone: tap to add, drag a note to move it, drag empty space to scroll.
- **Erase tool**: click/tap or drag over notes to delete them.
- **Snap** sets the grid (1/16 by default; "Off" for free timing). Use the **BPM** box for the
  tempo, the magnifier buttons or Ctrl+wheel to zoom, and Ctrl+Z / Ctrl+Y to undo/redo.
- **Overlapping notes**: the buzzer plays their **resultant frequency**. Adding two equal sine
  waves gives sin a + sin b = 2·cos((a−b)/2)·sin((a+b)/2), a wave at the **mean** frequency whose
  volume beats at |f1−f2|. A buzzer can only hold one frequency, so it plays the mean of all
  sounding notes (C4 262 Hz + E4 330 Hz → 296 Hz). The readout on the right shows it
  (`C4+E4 → 296 Hz`). The same note struck again right after itself gets a 50 ms gap, so you hear
  two notes instead of one long one.
- **Play** (Space) starts at the orange marker; click/drag the bar ruler to move it. Use ⏮ to go
  back to the start and 🔁 to loop. The metronome ticks on the device speaker only, never the buzzer.
- **Record** (red ●): playback starts from the marker, and every note you play on the piano below
  the roll (or the computer keys, or the key column on the left) is added to the melody, snapped
  to the grid. Existing notes keep playing, so you can layer. One Undo removes the whole take.
- **Accounts**: press **Log in** to create an account (username + password). Then use **Save**
  (Ctrl+S) and **My melodies** to open ▶ play, Open (edit), duplicate or delete your saved
  melodies. Without an account you can still compose; the work in progress is kept in the
  browser (localStorage) until you save it.

### Test without the ESP32

```sh
uv run tools/fake_esp32.py      # Ctrl-C to stop, --silent for no sound
```
The laptop advertises as **ESP32-Piano** with the same Bluetooth service. It prints each note it
receives, with the time since the previous one, and plays it on the laptop speaker. Open the
website on **another device** (the phone) and connect, because a browser can't connect to its
own computer's Bluetooth.

### Run the website locally

```sh
cd web
npm install
echo 'MONGODB_URI=mongodb+srv://<user>:<password>@mycluster.jrnmp.mongodb.net/' > .env.local   # once; never commit it
npm run dev            # http://localhost:3000 (static files + the api/ functions, like Vercel)
```
Web Bluetooth also works on `http://localhost` (a secure context), so you can connect the ESP32
from the laptop's Chrome too.

### Deploy

The Vercel project **`piano-web`** is connected to the GitHub repo
`Pablo-Caballero-Maria/piano`. **Every push to `main` deploys to production**
(https://piano-web-virid.vercel.app/), and pushes to other branches get preview URLs. Project settings:
- **Root Directory: `web`**. Framework preset "Other"; `web/vercel.json` serves `public/`.
- **Environment variable `MONGODB_URI`** = the Atlas connection string (optional `MONGODB_DB`,
  default `piano`). After changing it, redeploy.

The Vercel team is the user's Hobby team, `pablo-caballero-marias-projects`. Vercel sometimes
asks for an email-code re-authentication, which only the user can do.

### Backend (accounts and melodies)

MongoDB Atlas cluster `mycluster.jrnmp.mongodb.net` (the user's), database **`piano`**. The cluster
also hosts other projects' databases (`sinophile`, `sinophile_dev`); leave those alone.
Collections:
- `users` {username, usernameLower (unique), passwordHash (scrypt), createdAt}
- `sessions` {tokenHash (SHA-256 of the cookie token), userId, expiresAt (TTL index, 30 days)}
- `melodies` {userId, name, bpm, notes: [{p: MIDI note, s: start, d: duration (beats)}], noteCount, length, createdAt, updatedAt}

Login is an HttpOnly, Secure, SameSite=Lax cookie `piano_session` holding a random token.
API (JSON):

| Route | |
|---|---|
| `POST /api/auth/register`, `POST /api/auth/login` | `{username, password}` → `{user}` and sets the cookie |
| `POST /api/auth/logout`, `GET /api/auth/me` | → `{user}` or `{user: null}` |
| `GET /api/melodies` | the user's melodies, newest first, without notes |
| `POST /api/melodies` | `{name, bpm, notes}` → `{melody}` (max 5000 notes, 500 melodies per user) |
| `GET / PUT / DELETE /api/melodies/<id>` | one melody (another user's answers 404) |

The connection string is a secret: it lives only in Vercel's environment variables and
`web/.env.local` (git-ignored). The repo is public, so never commit it.

### Troubleshooting

- **ESP32-Piano doesn't appear in the list**: check that the ready chirp played, then
  stay close. Only one device can be connected at a time, so disconnect any other phone.
  This includes `fake_esp32.py`: don't run it at the same time as the real board, or the
  chooser shows two "ESP32-Piano"s.
- **"This browser can't use Bluetooth" on Linux Chrome**: open `chrome://flags/#enable-web-bluetooth`
  (or `#enable-experimental-web-platform-features`), set it to **Enabled** and relaunch Chrome.
  BlueZ must be running (`systemctl status bluetooth`). This is already done on this laptop.
- **"Couldn't connect: Connection attempt failed." on Android**: common on the first try
  (Android's GATT error 133). Just press Connect again; the retry worked on 2026-11-03.
- **Connected but silent**: check the wiring and the volume (`VOLUME` in `esp32/main.py`).
  Quick buzzer check (stop the firmware first): a magnetic buzzer's coil (~20-40 Ω) pulls D33
  to GND, so with the internal pull-up D33 reads 0 when the buzzer is connected, 1 when the
  circuit is open:
  `uv run mpremote connect /dev/ttyUSB0 exec "from machine import Pin; print(Pin(33, Pin.IN, Pin.PULL_UP).value())"`
  If it flips between 0 and 1 when you touch things, there's a loose contact (see History, 2026-11-03).
- **`mpremote` can't open /dev/ttyUSB0**: check that `id` lists `uucp`, and that no other
  `mpremote` or serial monitor is holding the port.
- **No /dev/ttyUSB0 at all, but `journalctl -k` shows the CP2102 (`10c4:ea60`)**: the kernel
  was upgraded without a reboot, so the running kernel's modules (`cp210x`) are gone. Reboot, or
  load it from the cached package of the running kernel (`uname -r`) without rebooting:
  `tar --zstd -xf /var/cache/pacman/pkg/linux-zen-<running version>-x86_64.pkg.tar.zst --wildcards '*/cp210x.ko.zst'`,
  `zstd -d` it, then `sudo insmod cp210x.ko` (needs the user's password, so a separate terminal).
  Installing Arch's `kernel-modules-hook` package prevents this.

### Protocol

BLE service `7a3e0001-5c2b-4f8e-9d61-3b2f1c9a8e10`, characteristic
`7a3e0002-5c2b-4f8e-9d61-3b2f1c9a8e10` (write / write without response).
Each write is 2 bytes: the frequency in Hz as a little-endian uint16, where 0 means silence.
The page sends a write only when the sounding note changes. While one write is in flight,
it keeps just the newest note, so a backlog can't build up and add delay. The page also sends
the current state (normally 0) right after connecting.
The UUIDs and the name `ESP32-Piano` are hard-coded in `esp32/main.py`, `web/public/js/ble.js` and
`tools/fake_esp32.py`; change all three together. The Studio uses the same protocol: it sends the
resultant frequency whenever it changes.

---

## Project context (for the next Claude Code session: read this first)

### Goal
A class project: a web piano (on **Vercel**, must work on **PC and phone**)
that sends the notes in real time over the device's **Bluetooth** to an ESP32 nearby, which
plays them on a buzzer. The site's UI is in English. Since 2026-11-04 it also has an FL-Studio-like
**Studio** mode with user accounts (MongoDB Atlas), and Vercel deploys straight from GitHub. The user's Claude memory says to start
each session by reading this README and to keep it updated with anything new.

### Current status (2026-11-04)
| Part | Status |
|---|---|
| `buzzer.py` on the real ESP32 | ✅ The user confirmed it "works perfectly" on 2026-10-28 (so the buzzer is **passive**) |
| Website on Vercel | ✅ Live. Since 2026-11-04 Vercel deploys from GitHub (`main` → production; Root Directory `web`, env `MONGODB_URI` set by the user) |
| Studio + accounts | ✅ Deployed (commit 36c7d36). The live API reaches Atlas (`/api/auth/me` 200, `/api/melodies` 401 logged out); server files like `lib/` and `.env.local` answer 404. Tested in Chrome on localhost; real phone + ESP32 test: see History 9 |
| Piano UI (keys, glissando, keyboard, octaves) | ✅ Tested on the live site with Claude in Chrome |
| BLE from the website to a receiver | ✅ Tested end to end: Android phone → laptop running `fake_esp32.py` |
| `esp32/main.py` on the real ESP32 | ✅ Starts with no changes on MicroPython 1.29; the Redmi 12 connects (LED on GPIO 2 lights), and every note arrives with the right frequency and drives PWM on D33 (verified with a logging copy) |
| Sound from the buzzer | ✅ **Works end to end** (phone → BLE → ESP32 → buzzer), **as long as the ESP32 is pressed firmly into the breadboard**. It sits loosely there, and D33/GND lose contact with any vibration. Wire the buzzer straight to the board's pins to make it reliable |

### Runbook: when the user says "the ESP32 is connected now"
1. Check the board is there: `ls /dev/ttyUSB*` and
   `uv run mpremote connect /dev/ttyUSB0 exec "import sys; print(sys.implementation, sys.version)"`.
   Write the MicroPython version into this README.
2. Make sure `fake_esp32.py` isn't running (`ps -eo pid,args | grep [f]ake_esp32`).
3. Start the firmware **in the background** so its output can be read:
   `uv run mpremote connect /dev/ttyUSB0 run esp32/main.py` (it runs forever; stop the task when done).
   Expect `Advertising as ESP32-Piano - ...` and ask the user whether the ready chirp played.
   - If it crashes, the most likely spots are `ble.config(gap_name=...)` (already in a
     try/except), `bytes(SERVICE_UUID)` in `RESP_DATA`, the `gatts_register_services` unpacking,
     and `PWM(...)`/`duty_u16` on old firmware. Fix them, then rerun.
4. Ask the user to open the live site on the phone (Chrome on Android, a Redmi 12), press Connect,
   pick ESP32-Piano and play. The log should show `Connected`, and the user should hear the notes on
   the buzzer, the connect chirp, and the disconnect chirp after pressing Disconnect.
5. Optionally also test from the laptop's Chrome (Web Bluetooth flag already enabled).
6. If the user wants it to run without the laptop:
   `uv run mpremote connect /dev/ttyUSB0 cp esp32/main.py :main.py + reset`.
7. Record the results here (Current status table + History).

### Hardware
- **ESP32** dev board running **MicroPython v1.29.0** (2026-08-24, `ESP32_GENERIC`, "Generic ESP32
  module with ESP32"). Its filesystem has the teacher's `blink.py` and `boot.py` (the default
  139-byte one); leave them alone. Since 2026-11-03 it also has **our `main.py`**, so the piano
  firmware starts on every power-up/reset. `mpremote` still works while it runs (it interrupts it
  with Ctrl-C). Before giving the board back, ask the user whether to remove it (`rm :main.py`). It's **borrowed from the teacher**: the user only has it in
  class, so between classes nothing can be tested on hardware.
- It connects over USB at **`/dev/ttyUSB0`** through a CP2102 USB-UART chip (`10c4:ea60`).
- **Buzzer**: a 3-pin passive magnetic module: a coil of roughly 20-40 Ω between S and −. Wiring:
  **S → D33 = GPIO 33**, **− → GND**, and since 2026-11-03 the middle pin (VCC/+) → **3V3**. The
  first module also played with only S and −. On 2026-11-03 it was swapped for a second one,
  but it probably wasn't broken (see History).
- **The ESP32 sits loosely in the breadboard.** D33 and GND only make contact when the board is
  pressed in. This was the root cause of "no sound" on 2026-11-03. Press it in fully, or plug the
  dupont wires straight onto the board's header pins.
- The on-board LED is **blue, on GPIO 2** (confirmed 2026-11-03), as the firmware assumes.
- **The user's phone**: a Xiaomi Redmi 12 running Android, using Chrome. Web Bluetooth works on it.

### Laptop (Arch Linux, fish shell, zen kernel 7.2.x, Google Chrome 156)
- **mpremote** is a dependency of the uv project in this directory (`pyproject.toml`, `.venv`). Run it as `uv run mpremote ...`; it is no longer installed globally.
- **Serial permission**: `/dev/ttyUSB0` is `root:uucp`, mode 660, and the user is in the `uucp` group.
- **Bluetooth**: a MediaTek MT7920 Wi-Fi + Bluetooth combo (`hci0`, `btusb`/`btmtk`). BlueZ 5.87
  is installed (`bluez`, `bluez-utils`). The controller supports the peripheral role and LE
  advertising. **On 2026-11-03 `bluetooth.service` was disabled and inactive** (it was enabled on
  10-28), so `bluetoothctl` just hangs. `fake_esp32.py` and laptop Chrome need
  `sudo systemctl enable --now bluetooth` first. The phone → ESP32 path doesn't need it.
- **Chrome**: Web Bluetooth is enabled in `chrome://flags`, because it's off by default on Linux.
  `navigator.bluetooth.getAvailability()` returns true on the live site.
- **Python**: `python-dbus` is installed, but `python-gobject` (`gi.repository`) is NOT. That's
  why `fake_esp32.py` uses `dbus-fast` through `uv run`, which pulls it in automatically
  (PEP 723 header). `pacat` is used for sound.
- Claude in Chrome (the browser extension) is available. It was used to deploy to Vercel and to
  test the site; it can't operate Chrome's native Bluetooth device chooser.

### History / decisions
1. **2026-10-28**: `buzzer.py` was written and run with `uv run mpremote connect /dev/ttyUSB0 run buzzer.py`.
   The user confirmed it "works perfectly". It uses PWM with `duty_u16`, falling back to `duty`
   on older firmware, at `VOLUME = 0.5`.
2. The user returned the ESP32 and asked for the Bluetooth piano for the next class.
   That's how `esp32/main.py` and `web/index.html` came about. The design:
   - The ESP32 uses MicroPython's low-level `bluetooth` module rather than `aioble`, so nothing
     extra has to be installed on the board. It's a BLE peripheral with a custom service.
   - The name goes in the advertising packet and the 128-bit service UUID goes in the scan
     response, because both don't fit in 31 bytes.
   - The browser picks the device by name or service. Writes are handled inside the BLE IRQ for
     the lowest latency.
   - Chirps run from the main loop. On disconnect the buzzer is silenced and advertising restarts.
   - The buzzer is monophonic, so the web app plays only the last held note, falling back to the
     previous held one. It writes only when the sounding note changes, with one write in flight
     at a time (newest value wins).
   - Sliding a finger across keys plays a glissando (pointer events + `elementFromPoint`). The
     computer keys are matched by physical position (`e.code`), with labels from
     `navigator.keyboard.getLayoutMap()`, so the Spanish layout shows `Ñ` on the Semicolon key.
   - The number of keys adapts to the screen width (7–22 white keys); octaves 1–6.
   - An optional "Device sound" toggle plays a WebAudio square wave on the phone or PC
     (off by default, remembered in localStorage).
   - All notes are released on blur or when the tab is hidden.
   - A banner explains when Bluetooth isn't available: not https, an unsupported browser, or
     Linux Chrome with the flag still off.
3. The laptop had no BlueZ. The user installed it and then enabled the Chrome flag.
4. The site was deployed with Vercel drop as project `piano-web`, then redeployed into the same
   project with the Linux banner text.
5. Tested the piano on the live site with Claude in Chrome. A glissando drag sent
   262, 294, 330, 392, 440, 494 then 0; the `H` key sent 440 then 0; octave + works; no stuck notes.
6. Wrote `tools/fake_esp32.py` and ran an **end-to-end BLE test**: Chrome on the Redmi 12
   connected to the laptop, and the user played notes and heard them on the PC speakers.
   - **Log:** 96 writes, all in order. A glissando arrived as G4 A4 B4 C5 B4 A4 G4, then 0, and
     every key release sent 0.
   - **Latency:** the gaps between writes are quantized to multiples of about 49 ms (49/98/147/195),
     which is Android's default BLE connection interval of ~48.75 ms. Each note can arrive up to
     ~50 ms late, and two writes can share one connection event (0 ms gaps). Fine for melodies.
     If it ever feels laggy, the fix is a shorter connection interval requested by the peripheral.
     As far as I know, MicroPython's `bluetooth` module doesn't expose that.
   - **Tool bug, fixed afterwards:** "Connected" didn't print, because a new phone appears via
     InterfacesAdded already connected. The fixed version wasn't re-run with the phone.

7. **2026-10-30**: Published to GitHub (`Pablo-Caballero-Maria/piano`, public). Added `.gitignore`
   (`.venv`, `piano-web.zip`, `.claude/settings.local.json`), setup instructions, and doc
   comments/docstrings for the functions that had none. Code behaviour unchanged.

8. **2026-11-03 (in class, board connected)**:
   - `/dev/ttyUSB0` was missing: the laptop's kernel had been upgraded (7.2.11 → 7.2.14) without a
     reboot. Fixed by loading `cp210x.ko` from the cached 7.2.11 package with `sudo insmod`
     (see Troubleshooting).
   - The board runs MicroPython v1.29.0. `esp32/main.py` ran **unchanged with no errors**. The
     first Android connect failed ("Connection attempt failed."), and a plain retry worked. The
     blue LED (GPIO 2) lights on connect.
   - **No sound, from any script.** Diagnosed from the board without a multimeter:
     - Continuity: internal pull-up on D33, where 0 means the coil pulls it to GND, and D32 as a
       blank reference.
     - Load: ADC on D33 while driven high. 1.2 V means coil present and 3.1 V means nothing
       connected. The ADC must be created **before** the PWM, because creating it after
       disconnects the PWM output. And at audio frequencies the "max" reading catches the coil's
       switching spikes, so it is useless there.
     - PWM: 10 Hz PWM sampled by the ADC. It toggles fine, also with BLE active, so BLE does not
       interfere with D33.
     - Notes: a logging copy of the firmware showed 110+ notes arriving with the right
       frequencies, each one starting/stopping the PWM.
   - **Cause: bad contacts, not the code.** First the GND dupont wire was loose, and the user
     replaced it. The contact still opened after a note or two. That made me wrongly blame the
     buzzer module (pressing on it closed the circuit), so the user swapped it for another one,
     and the new one did the same. The real culprit was **the ESP32 itself sitting loosely in
     the breadboard**. With the LED contact finder (`contact_led.py` idea: GPIO 2 LED = D33
     pull-up reads 0), pressing the board in closed the circuit, and then the piano played.
     The buzzer's own vibration was enough to open the contact, which is why it always went
     silent after the first few notes.
   - Tried `Pin.DRIVE_3` (max pin current) on the buzzer pin, then **reverted** it. It wasn't the
     problem, and with a ~20-40 Ω coil it pushes the pin past its rated current on the teacher's
     board.
   - **End-to-end success**: with the board pressed in, the ready chirp played and the piano on the
     Redmi 12 played notes on the buzzer.
   - Still pending: the page's initial "0" write right after connecting may cut the 140 ms connect
     chirp short. Fix that in the firmware, e.g. ignore 0 writes while a chirp plays, or make
     chirps not interruptible.
   - **Installed as `:main.py`** (`mpremote cp esp32/main.py :main.py`), so it runs by itself on
     power-up. Verified with a hard reset (EN pulsed via RTS) and the serial log: after the ROM boot
     messages it printed `Advertising as ESP32-Piano - ...` with no errors. Board files now:
     `blink.py`, `boot.py`, `main.py`.
   - The user had set `VOLUME = 1` (100% duty, which keeps D33 at a steady high, so a passive
     buzzer only clicks). It was installed like that first, then the user asked to go back to
     **`VOLUME = 0.5`** (the committed value). That version was reinstalled as `:main.py`, the
     sizes match the repo (4473 bytes), and after a reset it printed `Advertising as ESP32-Piano`.

9. **2026-11-04**: the user asked for an FL-Studio-like "studio" mode, accounts on MongoDB
   Atlas, live recording from the piano, and GitHub → Vercel auto-deploys. Done as follows:
   - `web/index.html` was split into `web/public/` (ES modules, no build step), plus Vercel
     functions in `web/api/` and shared code in `web/lib/`. The Piano mode behaves as before.
   - "Overlapping notes play the resultant frequency" = the **arithmetic mean** of the sounding
     notes' frequencies (the carrier of the summed waves, see Studio above). Notes are stored in
     beats, so changing the BPM keeps the rhythm.
   - The emoji icons were replaced by an inline SVG sprite: this laptop's Chrome has no emoji
     font (they showed as boxes), and Android draws ▶ as a colored emoji.
   - Tested locally (`npm run dev` + Claude in Chrome): the API with curl (register/login/logout,
     CRUD, validation, users can't see each other's melodies), editing (add/move/resize/delete,
     undo/redo), playback timing (C4 then C4+E4 then E4 at 120 BPM: 262 → 296 → 330 Hz switching
     at exactly 500 ms steps, the 50 ms re-strike gap, stop at the end), recording held keys
     (snapped, chords recorded, one undo per take), save with the login dialog, list/open/play/
     duplicate/delete, and phone-sized layouts. The real ESP32 was not available, so the Studio
     → buzzer path is untested on hardware (it uses the same `send()` as the piano).
   - The Vercel project `piano-web` (created with Vercel drop) was connected to the GitHub repo,
     with Root Directory `web` and the `MONGODB_URI` env var.
   - `esp32/main.py` changed only in two comments (the path of the web code), so the copy
     installed on the board is still functionally the same.

### Not verified yet
- The actual latency on the real board, and whether the connect/disconnect chirps are audible.
- The fixed connect/disconnect logging in `tools/fake_esp32.py`.
- The site on an iPhone (Bluefy) or on Windows/macOS.
- The Studio on the real ESP32 (needs the board, i.e. a class day), and the Studio on the phone
  with real touch input (tested only at phone sizes with a mouse).

### Ideas for later
A volume control (a 3rd byte in the protocol), showing the ESP32's connection quality,
an "arpeggio" option for overlapping notes (cycle through them fast, which sounds more like a
chord than the mean), sharing melodies between users, and pinch-to-zoom on the roll.
