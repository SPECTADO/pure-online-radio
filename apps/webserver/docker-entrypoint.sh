#!/bin/sh
set -e

mkdir -p /etc/caddy/generated
envsubst '${PUBLIC_BASE_URL}' < /etc/caddy/templates/env-config.js.template > /etc/caddy/generated/env-config.js

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
