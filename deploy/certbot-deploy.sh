#!/bin/bash
# certbot --deploy-hook (also after each renewal): Mosquitto runs as its own user and can't read
# /etc/letsencrypt, so it gets a copy of the certificate; then nginx and Mosquitto reload it.
set -euo pipefail
live=/etc/letsencrypt/live/@DOMAIN@
install -d -m 750 -o root -g mosquitto /etc/mosquitto/certs
install -m 640 -o root -g mosquitto "$live/fullchain.pem" "$live/privkey.pem" /etc/mosquitto/certs/
systemctl try-restart mosquitto
systemctl try-reload-or-restart nginx
