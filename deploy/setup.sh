#!/bin/bash
# One-time setup of the teacher's PC (safe to run again). ./install.sh runs it; by hand:
#
#     sudo deploy/setup.sh
#
# Needs: nginx, mosquitto, certbot, curl and uv (./install.sh installs them), and .env with
# DUCKDNS_DOMAIN and DUCKDNS_TOKEN. Works on Arch, Debian/Ubuntu and Fedora. It:
#   1. generates the MQTT passwords if .env has none (MQTT_FOG_PASSWORD, MQTT_BOARD_PASSWORD);
#   2. points <domain>.duckdns.org at this PC's address on the classroom network;
#   3. gets a Let's Encrypt certificate with a DNS challenge (works on a private address), and
#      enables its automatic renewal (certbot-renew.timer);
#   4. configures Mosquitto (TLS for the boards, users and per-board topic rights) and nginx (HTTPS);
#   5. installs and starts the app as a service (piano-fog), restarting on failure and after updates.
# Original /etc/nginx/nginx.conf and /etc/mosquitto/mosquitto.conf are kept as *.orig.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Run it with sudo: sudo deploy/setup.sh" >&2; exit 1; }
export PATH="$PATH:/usr/sbin:/sbin"
for cmd in nginx mosquitto mosquitto_passwd certbot curl; do
    command -v "$cmd" > /dev/null || { echo "Missing $cmd: ./install.sh installs it" >&2; exit 1; }
done

REPO=$(cd "$(dirname "$0")/.." && pwd)
DEPLOY=$REPO/deploy
ENV_FILE=$REPO/.env
OWNER=$(stat -c %U "$REPO")
OWNER_HOME=$(getent passwd "$OWNER" | cut -d: -f6)
UV=$(sudo -u "$OWNER" bash -lc 'command -v uv' 2> /dev/null || true)
for candidate in "$UV" /usr/bin/uv /usr/local/bin/uv "$OWNER_HOME/.local/bin/uv" "$OWNER_HOME/.cargo/bin/uv"; do
    [ -n "$candidate" ] && [ -x "$candidate" ] && { UV=$candidate; break; }
done
[ -x "$UV" ] || { echo "uv not found: ./install.sh installs it" >&2; exit 1; }
NGINX_USER=$(for u in http www-data nginx; do id "$u" > /dev/null 2>&1 && echo "$u" && break; done || true)
NGINX_USER=${NGINX_USER:-nobody}
[ -f "$ENV_FILE" ] || { echo "No $ENV_FILE: run ./install.sh (or copy .env.example to .env and fill it in)" >&2; exit 1; }

env_get() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
env_set() {  # add or replace KEY=value in .env, keeping its owner and permissions
    if grep -qE "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; else echo "$1=$2" >> "$ENV_FILE"; fi
}

DOMAIN_NAME=$(env_get DUCKDNS_DOMAIN)
TOKEN=$(env_get DUCKDNS_TOKEN)
BOARD=$(env_get PIANO_BOARD_ID); BOARD=${BOARD:-piano1}
[ -n "$DOMAIN_NAME" ] && [ -n "$TOKEN" ] || { echo "Set DUCKDNS_DOMAIN and DUCKDNS_TOKEN in .env" >&2; exit 1; }
DOMAIN=${DOMAIN_NAME%.duckdns.org}.duckdns.org
fill() {
    sed -e "s|@DOMAIN@|$DOMAIN|g" -e "s|@REPO@|$REPO|g" -e "s|@USER@|$OWNER|g" -e "s|@UV@|$UV|g" \
        -e "s|@NGINX_USER@|$NGINX_USER|g" "$1"
}

echo "== 1. MQTT passwords"
for var in MQTT_FOG_PASSWORD MQTT_BOARD_PASSWORD; do
    if [ -z "$(env_get "$var")" ]; then
        env_set "$var" "$(head -c 18 /dev/urandom | base64 | tr '+/' '-_')"
        echo "   generated $var (in .env)"
    fi
done

echo "== 2. DuckDNS: $DOMAIN -> this PC's classroom address"
LAN_IP=$(ip route get 192.0.2.1 | sed -n 's/.* src \([0-9.]*\).*/\1/p')
answer=$(curl -fsS "https://www.duckdns.org/update?domains=${DOMAIN%.duckdns.org}&token=$TOKEN&ip=$LAN_IP")
echo "   $LAN_IP: $answer"

echo "== 3. Certificate"
install -d -m 700 /etc/piano
printf '%s' "$TOKEN" > /etc/piano/duckdns.token && chmod 600 /etc/piano/duckdns.token
for hook in certbot-duckdns-auth.sh certbot-duckdns-cleanup.sh certbot-deploy.sh; do
    fill "$DEPLOY/$hook" > "/etc/piano/$hook" && chmod 700 "/etc/piano/$hook"
done
if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
    certbot certonly --non-interactive --agree-tos --register-unsafely-without-email \
        --manual --preferred-challenges dns \
        --manual-auth-hook /etc/piano/certbot-duckdns-auth.sh \
        --manual-cleanup-hook /etc/piano/certbot-duckdns-cleanup.sh \
        --deploy-hook /etc/piano/certbot-deploy.sh \
        -d "$DOMAIN"
else
    echo "   already there (renewed automatically)"
fi
# Renewal: the distribution's timer (Arch, Fedora: certbot-renew; Debian: certbot), or our own
RENEW=$(for t in certbot-renew.timer certbot.timer snap.certbot.renew.timer; do
    systemctl cat "$t" > /dev/null 2>&1 && echo "$t" && break
done || true)
if [ -z "$RENEW" ]; then
    RENEW=piano-certbot-renew.timer
    printf '[Unit]\nDescription=Renew the Let'"'"'s Encrypt certificate\n[Service]\nType=oneshot\nExecStart=%s renew --quiet\n' \
        "$(command -v certbot)" > /etc/systemd/system/piano-certbot-renew.service
    printf '[Unit]\nDescription=Renew the certificate twice a day\n[Timer]\nOnCalendar=*-*-* 00,12:00\nRandomizedDelaySec=1h\nPersistent=true\n[Install]\nWantedBy=timers.target\n' \
        > /etc/systemd/system/piano-certbot-renew.timer
    systemctl daemon-reload
fi
systemctl enable --now "$RENEW"

echo "== 4. Mosquitto and nginx"
[ -f /etc/mosquitto/mosquitto.conf.orig ] || cp -a /etc/mosquitto/mosquitto.conf /etc/mosquitto/mosquitto.conf.orig 2>/dev/null || true
fill "$DEPLOY/mosquitto.conf" > /etc/mosquitto/mosquitto.conf
{
    fill "$DEPLOY/mosquitto.acl"
    printf '\n# Board %s: only its own topics\nuser board-%s\n' "$BOARD" "$BOARD"
    for t in tone chirp kv/req ota; do echo "topic read piano/$BOARD/$t"; done
    for t in kv/res status log; do echo "topic write piano/$BOARD/$t"; done
} > /etc/mosquitto/piano.acl
rm -f /etc/mosquitto/piano.passwd
mosquitto_passwd -b -c /etc/mosquitto/piano.passwd fog "$(env_get MQTT_FOG_PASSWORD)"
mosquitto_passwd -b /etc/mosquitto/piano.passwd "board-$BOARD" "$(env_get MQTT_BOARD_PASSWORD)"
chown root:mosquitto /etc/mosquitto/piano.passwd /etc/mosquitto/piano.acl
chmod 640 /etc/mosquitto/piano.passwd /etc/mosquitto/piano.acl
/etc/piano/certbot-deploy.sh  # the certificate copy for Mosquitto
[ -f /etc/nginx/nginx.conf.orig ] || cp -a /etc/nginx/nginx.conf /etc/nginx/nginx.conf.orig
fill "$DEPLOY/nginx.conf" > /etc/nginx/nginx.conf
nginx -t
systemctl enable --now mosquitto nginx
systemctl restart mosquitto nginx

echo "== 5. The app (piano-fog service)"
sudo -u "$OWNER" "$UV" sync --frozen --project "$REPO" > /dev/null
fill "$DEPLOY/piano-fog.service" > /etc/systemd/system/piano-fog.service
systemctl daemon-reload
systemctl enable piano-fog
systemctl restart piano-fog

echo
echo "Done. Open https://$DOMAIN from a phone on the classroom network."
echo "Logs: journalctl -u piano-fog -f    Check: cd $REPO && uv run python -m fog check"
echo "Board: plug it in by USB and run: ./install.sh board"
