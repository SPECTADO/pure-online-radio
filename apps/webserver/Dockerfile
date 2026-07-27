FROM caddy:2-alpine

RUN apk add --no-cache gettext

COPY env-config.js.template /etc/caddy/templates/env-config.js.template
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
