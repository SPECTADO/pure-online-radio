#!/bin/sh
set -e

# The template wraps each password in a double-quoted NATS string -- escape `\`
# and `"` first so a generated secret containing either can't terminate the
# string (config parse error, nats exits) or be read as an escape sequence
# (the effective password silently differs from what api/encoder send).
escape_nats_string() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}
API_NATS_PASSWORD=$(escape_nats_string "$API_NATS_PASSWORD")
ENCODER_NATS_PASSWORD=$(escape_nats_string "$ENCODER_NATS_PASSWORD")
CONTROL_PANEL_NATS_PASSWORD=$(escape_nats_string "$CONTROL_PANEL_NATS_PASSWORD")
export API_NATS_PASSWORD ENCODER_NATS_PASSWORD CONTROL_PANEL_NATS_PASSWORD

envsubst '${API_NATS_PASSWORD} ${ENCODER_NATS_PASSWORD} ${CONTROL_PANEL_NATS_PASSWORD}' \
  < /etc/nats/nats-server.conf.template > /etc/nats/nats-server.conf

exec nats-server -c /etc/nats/nats-server.conf
