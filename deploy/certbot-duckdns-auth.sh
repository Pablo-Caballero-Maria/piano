#!/bin/bash
# certbot --manual-auth-hook: prove we own @DOMAIN@ by putting the challenge in DuckDNS's TXT
# record (a DNS-01 challenge works although the name points at a private classroom address).
# Installed in /etc/piano/ by deploy/setup.sh; the token is in /etc/piano/duckdns.token (root only).
set -euo pipefail
token=$(< /etc/piano/duckdns.token)
answer=$(curl -fsS "https://www.duckdns.org/update?domains=${CERTBOT_DOMAIN%.duckdns.org}&token=${token}&txt=${CERTBOT_VALIDATION}")
[ "$answer" = "OK" ] || { echo "DuckDNS refused the TXT record: $answer" >&2; exit 1; }
sleep 60  # let the record spread to DuckDNS's name servers
