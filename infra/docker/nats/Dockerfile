FROM nats:2.11-alpine

RUN apk add --no-cache gettext

COPY nats-server.conf.template /etc/nats/nats-server.conf.template
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
