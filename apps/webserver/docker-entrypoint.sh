#!/bin/sh
set -e

mkdir -p /etc/nginx/generated
envsubst '${PUBLIC_BASE_URL}' < /etc/nginx/templates/env-config.js.template > /etc/nginx/generated/env-config.js

exec nginx -g 'daemon off;'
