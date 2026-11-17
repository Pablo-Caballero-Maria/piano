#!/bin/bash
# certbot --manual-cleanup-hook: clear the DuckDNS TXT record again.
set -euo pipefail
token=$(< /etc/piano/duckdns.token)
curl -fsS "https://www.duckdns.org/update?domains=${CERTBOT_DOMAIN%.duckdns.org}&token=${token}&txt=removed&clear=true" > /dev/null
