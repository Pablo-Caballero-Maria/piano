#!/bin/bash
# Sets up a teacher's PC, and the classroom board, from a fresh clone. Run it as yourself (not with
# sudo: it asks for your password when it needs it):
#
#     ./install.sh               everything; safe to run again (it only redoes what's needed)
#     ./install.sh board [port]  only the board, e.g. when you plug it in later (/dev/ttyUSB0…)
#     ./install.sh config        change the answers in .env, then run ./install.sh again
#
# 1. installs what's missing: nginx, mosquitto, certbot, curl (pacman, apt or dnf) and uv;
# 2. the app's Python and libraries (uv sync);
# 3. fills in .env: asks for what's missing (tools/configure.py);
# 4. sets up the PC (sudo deploy/setup.sh): DuckDNS, the certificate, Mosquitto, nginx and the
#    piano-fog service, all started at every boot;
# 5. offers to make the PC join the classroom WiFi at boot (before anyone logs in) and to keep it
#    running with the lid closed while plugged in;
# 6. installs the board's firmware if the board is plugged in by USB (tools/board.py setup);
# 7. checks everything (python -m fog check).
set -euo pipefail

REPO=$(cd "$(dirname "$0")" && pwd)
cd "$REPO"
export PATH="$PATH:/usr/sbin:/sbin:$HOME/.local/bin"  # Debian keeps nginx & co. in sbin; uv in ~/.local

say() { printf '\n== %s\n' "$*"; }
die() { printf '\n%s\n' "$*" >&2; exit 1; }
ask() { local a; read -r -p "   $1 [Y/n] " a; [[ ! $a =~ ^[nN] ]]; }
env_get() { grep -E "^$1=" .env 2> /dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }

[ "$(id -u)" != 0 ] || die "Run it as yourself, without sudo: ./install.sh (it asks for your password when needed)."
[ -d /run/systemd/system ] || die "This PC needs Linux with systemd (Arch, Debian/Ubuntu, Fedora…)."

packages() {
    say "1. Programs"
    local missing=() install=()
    for cmd in nginx mosquitto mosquitto_passwd certbot curl; do
        command -v "$cmd" > /dev/null || missing+=("$cmd")
    done
    command -v uv > /dev/null || missing+=(uv)
    if [ ${#missing[@]} = 0 ]; then
        echo "   all there"
        return
    fi
    echo "   missing: ${missing[*]}"
    if command -v pacman > /dev/null; then
        install=(sudo pacman -S --needed nginx mosquitto certbot curl uv)
    elif command -v apt-get > /dev/null; then
        install=(sudo sh -c "apt-get update && apt-get install -y nginx mosquitto certbot curl")
    elif command -v dnf > /dev/null; then
        install=(sudo dnf install -y nginx mosquitto certbot curl uv)
    else
        die "Install them with your package manager, then run ./install.sh again."
    fi
    ask "Install them now? (${install[*]})" || die "Install them, then run ./install.sh again."
    "${install[@]}"
    if ! command -v uv > /dev/null; then  # apt has no uv: its official installer, for this user
        ask "Install uv (https://docs.astral.sh/uv) for your user?" || die "Install uv, then run ./install.sh again."
        curl -LsSf https://astral.sh/uv/install.sh | sh
    fi
}

python_deps() {
    say "2. The app's Python and libraries"
    uv sync --frozen --quiet
    echo "   ready"
}

configure() {
    say "3. Settings (.env)"
    uv run --frozen tools/configure.py "$@"
}

pc() {
    say "4. This PC (sudo deploy/setup.sh)"
    sudo "$REPO/deploy/setup.sh"
}

wifi_at_boot() {
    local ssid pass uuid="" type id
    ssid=$(env_get WIFI_SSID)
    pass=$(env_get WIFI_PASSWORD)
    command -v nmcli > /dev/null && [ -n "$ssid" ] || return 0
    while IFS=: read -r id type; do
        [ "$type" = 802-11-wireless ] || continue
        if [ "$(nmcli -g 802-11-wireless.ssid connection show "$id" 2> /dev/null)" = "$ssid" ]; then
            uuid=$id
            break
        fi
    done < <(nmcli -t -f UUID,TYPE connection show)
    if [ -n "$uuid" ] && [ -z "$(nmcli -g connection.permissions connection show "$uuid")" ] &&
        [ "$(nmcli -g 802-11-wireless-security.psk-flags connection show "$uuid" 2> /dev/null || echo 0)" = 0 ]; then
        echo "   joins \"$ssid\" at boot already"
        return 0
    fi
    ask "Join the classroom WiFi \"$ssid\" at boot, before anyone logs in? (its password is stored for the system, readable only by root)" || return 0
    # The password goes on nmcli's command line: visible to other users of this PC for an instant
    local secret=()
    if [ -n "$pass" ]; then secret=(wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$pass" wifi-sec.psk-flags 0); fi
    if [ -n "$uuid" ]; then
        sudo nmcli connection modify "$uuid" connection.permissions "" connection.autoconnect yes "${secret[@]}"
    else
        sudo nmcli connection add type wifi con-name "$ssid" ssid "$ssid" connection.autoconnect yes "${secret[@]}" > /dev/null
    fi
    echo "   done: it joins \"$ssid\" whenever it's in range"
}

lid() {
    local conf=/etc/systemd/logind.conf.d/piano.conf
    ls /proc/acpi/button/lid/*/state > /dev/null 2>&1 || return 0  # not a laptop
    [ ! -f "$conf" ] || return 0
    ask "Keep the class running with the lid closed while plugged in? (on battery, closing it still suspends)" || return 0
    sudo mkdir -p "$(dirname "$conf")"
    printf '[Login]\n# ./install.sh: the piano class keeps running with the lid closed while plugged in\nHandleLidSwitchExternalPower=ignore\nHandleLidSwitchDocked=ignore\n' |
        sudo tee "$conf" > /dev/null
    echo "   done (from the next boot)"
}

board() {
    say "6. The board"
    local port=${1:-} group
    [ -n "$port" ] || port=$(ls /dev/ttyUSB* /dev/ttyACM* 2> /dev/null | head -1 || true)
    if [ -z "$port" ]; then
        echo "   No board on USB: plug it in and run ./install.sh board"
        return 0
    fi
    if [ ! -r "$port" ] || [ ! -w "$port" ]; then
        group=$(stat -c %G "$port")
        echo "   Your user can't use $port yet (group $group): giving it access"
        sudo usermod -aG "$group" "$USER"                                    # from your next login
        sudo setfacl -m "u:$USER:rw" "$port" 2> /dev/null || sudo chmod o+rw "$port"  # right now
    fi
    if ! uv run --frozen tools/board.py setup --port "$port"; then
        echo "   The board's setup failed. If it couldn't reach the board's prompt (raw REPL), the board"
        echo "   may not have MicroPython: install it (https://micropython.org/download/ESP32_GENERIC/,"
        echo "   v1.29), then run ./install.sh board"
        return 1
    fi
}

check() {
    say "7. Check"
    uv run --frozen python -m fog check || echo "   (see the BAD lines above)"
}

case "${1:-all}" in
board)
    python_deps
    board "${2:-}"
    ;;
config)
    python_deps
    configure --all
    echo "   Now run ./install.sh to apply them."
    ;;
all)
    packages
    python_deps
    configure
    pc
    say "5. Running on its own"
    wifi_at_boot
    lid
    failed=0
    board || failed=1
    check
    domain=$(env_get DUCKDNS_DOMAIN)
    say "Done"
    echo "   Phones on the classroom WiFi: https://${domain%.duckdns.org}.duckdns.org"
    echo "   From now on this PC starts it all at boot, follows its address on each network and"
    echo "   updates itself (and the board) from GitHub. Logs: journalctl -u piano-fog -f"
    exit $failed
    ;;
*) die "Usage: ./install.sh [board [port] | config]" ;;
esac
