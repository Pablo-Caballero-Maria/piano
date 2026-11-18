#!/bin/bash
# Undoes deploy/setup.sh on this PC (safe to run again):
#
#     sudo deploy/uninstall.sh
#
#   1. stops and removes the piano-fog service;
#   2. puts back the original nginx and Mosquitto configuration (the *.orig copies setup.sh kept),
#      removes the piano's MQTT users, rights and certificate copy, and stops and disables nginx
#      and Mosquitto unless they were enabled before setup.sh;
#   3. deletes the Let's Encrypt certificate of the DuckDNS name and, if no other certificate is
#      left, the renewal timer and certbot's folders that setup.sh brought;
#   4. removes /etc/piano (DuckDNS token, certbot hooks), the lid setting of ./install.sh and the
#      folder where updates were tested (~/.cache/piano).
# It leaves the packages (nginx, mosquitto, certbot…), the repository and its .env, the DuckDNS
# name (it keeps pointing at this PC's last address), the WiFi connections and the board.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Run it with sudo: sudo deploy/uninstall.sh" >&2; exit 1; }
export PATH="$PATH:/usr/sbin:/sbin"

REPO=$(cd "$(dirname "$0")/.." && pwd)
ENV_FILE=$REPO/.env
OWNER=$(stat -c %U "$REPO")
OWNER_HOME=$(getent passwd "$OWNER" | cut -d: -f6)
BEFORE=/etc/piano/before  # what the PC had before setup.sh's first run (older installs lack it)

env_get() { [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }
was() { [ -f "$BEFORE" ] && grep -E "^$1=" "$BEFORE" | tail -1 | cut -d= -f2- || true; }
unit_exists() { systemctl cat "$1" > /dev/null 2>&1; }

echo "== 1. The app (piano-fog service)"
if unit_exists piano-fog.service; then
    systemctl disable --now piano-fog.service
fi
rm -f /etc/systemd/system/piano-fog.service
systemctl daemon-reload
systemctl reset-failed piano-fog.service 2> /dev/null || true
echo "   removed"

echo "== 2. nginx and Mosquitto"
for conf in /etc/nginx/nginx.conf /etc/mosquitto/mosquitto.conf; do
    if [ -f "$conf.orig" ]; then
        mv -f "$conf.orig" "$conf"
        echo "   $conf: the original is back"
    else
        echo "   $conf: no original kept (setup.sh never ran here, or it's back already)"
    fi
done
rm -rf /etc/mosquitto/piano.acl /etc/mosquitto/piano.passwd /etc/mosquitto/certs
for unit in nginx.service mosquitto.service; do
    unit_exists "$unit" || continue
    if [ "$(was "$unit")" = enabled ]; then
        systemctl restart "$unit"
        echo "   $unit: it was enabled before setup.sh, so it stays (with its original configuration)"
    else
        systemctl disable --now "$unit" 2> /dev/null || true
        echo "   $unit: stopped and disabled"
    fi
done

echo "== 3. Certificate"
name=$(env_get DUCKDNS_DOMAIN)
domain=${name:+${name%.duckdns.org}.duckdns.org}
if [ -n "$domain" ] && [ -d "/etc/letsencrypt/live/$domain" ] && command -v certbot > /dev/null; then
    certbot delete --non-interactive --cert-name "$domain"
    echo "   $domain: deleted"
fi
if [ -f /etc/systemd/system/piano-certbot-renew.timer ]; then
    systemctl disable --now piano-certbot-renew.timer 2> /dev/null || true
    rm -f /etc/systemd/system/piano-certbot-renew.timer /etc/systemd/system/piano-certbot-renew.service
    systemctl daemon-reload
fi
if [ -n "$(find /etc/letsencrypt/live -mindepth 1 -maxdepth 1 -type d 2> /dev/null)" ]; then
    echo "   other certificates are left: certbot and its renewal stay"
else
    for timer in certbot-renew.timer certbot.timer snap.certbot.renew.timer; do
        unit_exists "$timer" || continue
        [ "$(was "$timer")" = enabled ] && continue
        if [ "$(systemctl is-enabled "$timer" 2> /dev/null || true)" = enabled ]; then
            systemctl disable --now "$timer"
            echo "   $timer: stopped and disabled"
        fi
    done
    if [ "$(was letsencrypt)" != present ] && [ -d /etc/letsencrypt ]; then
        rm -rf /etc/letsencrypt /var/lib/letsencrypt /var/log/letsencrypt
        echo "   removed certbot's folders (setup.sh made them)"
    fi
fi

echo "== 4. The rest"
rm -rf /etc/piano "$OWNER_HOME/.cache/piano"
if [ -f /etc/systemd/logind.conf.d/piano.conf ]; then
    rm -f /etc/systemd/logind.conf.d/piano.conf
    rmdir /etc/systemd/logind.conf.d 2> /dev/null || true
    echo "   closing the lid suspends again (from the next boot)"
fi
echo "   removed /etc/piano and $OWNER_HOME/.cache/piano"

echo
echo "Done. Still listening on the piano's ports (80, 443, 1883, 8883, 8080):"
ss -ltn | awk 'NR > 1 {print $4}' | grep -E ':(80|443|1883|8883|8080)$' || echo "   none"
echo "Kept: the packages, $REPO and its .env, the DuckDNS name and the board's firmware."
echo "To set it all up again: ./install.sh"
