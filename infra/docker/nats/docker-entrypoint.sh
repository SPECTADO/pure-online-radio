#!/bin/sh
set -e

envsubst '${API_NATS_PASSWORD} ${ENCODER_NATS_PASSWORD} ${CONTROL_PANEL_NATS_PASSWORD}' \
  < /etc/nats/nats-server.conf.template > /etc/nats/nats-server.conf

exec nats-server -c /etc/nats/nats-server.conf
