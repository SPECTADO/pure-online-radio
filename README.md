# Spectado — Pure Online Radio

A self-hosted online radio platform: a manager control panel for running the station, a public player, and an
automated ffmpeg-based encoder that produces a continuous multi-bitrate HLS stream from a scheduled/rotated song
queue, jingles, live mic input, and external stream relays. Everything runs as a single Docker Compose stack.

> **Status:** this repository is currently a **scaffold**. The full infrastructure, data model, and service wiring
> are real and verified working end-to-end (see [Implementation status](#implementation-status)), but most
> station-management business logic (queue resolution, library upload, clock wheels, jingle/mic mixing) is still
> stubbed out. See that section before assuming a feature works.

## Contents

- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Getting started (local development)](#getting-started-local-development)
- [Deployment](#deployment)
- [Configuration reference](#configuration-reference)
- [NATS subject contract](#nats-subject-contract)
- [Implementation status](#implementation-status)
- [Troubleshooting](#troubleshooting)

## How it works

1. **Library**: songs and jingles are uploaded (via the API) into MinIO (S3-compatible object storage), with metadata
   (title, artist, album, cover art, category/tags, duration) extracted from file tags and stored in Postgres via
   Prisma.
2. **Queue resolution**: the encoder continuously asks the API "what's next" (`GET /internal/playback/next`) as the
   current track nears its end. The API resolves this in priority order: a manager-scheduled one-off item due now →
   the active **clock wheel** for the current weekday/time slot (an ordered sequence of abstract picks like "song
   from category TOP, random" or "song from category HITS, least-often-played", each resolved to a concrete track
   while enforcing artist/song **separation rules**) → a fallback category. The result is a signed, time-limited
   MinIO URL the encoder can stream directly — the encoder never holds storage credentials itself.
3. **Encoding**: the encoder mixes whatever should currently be audible (queue track, jingle overlay, live mic
   overlay, or an external relay) into a single continuous PCM bus, which a persistent ffmpeg process encodes into
   two HLS variants (low/high bitrate AAC) written to a shared volume.
4. **Delivery**: nginx is the *only* public entry point. It serves the built control panel and player SPAs, reverse
   proxies the API, serves the HLS output directly from the shared volume, and proxies both the NATS websocket
   (realtime status) and the encoder's live-mic ingestion websocket.
5. **Realtime control**: the control panel sends commands (skip, play jingle, switch live/manual mode, start/stop
   live mic, schedule an external relay) over authenticated HTTP to the API, which publishes them to NATS. The
   encoder consumes those commands and publishes status (now-playing, queue-advanced, errors, heartbeat) back over
   NATS, which both the API and the control panel's browser (over NATS websocket, subscribe-only) consume directly.
6. **Public player**: has no visibility into any of the above — it just polls a public, cached "now playing" endpoint
   and plays the HLS stream.

## Architecture

```mermaid
flowchart TB
    subgraph Public["Public internet"]
        Listener["Listener browser"]
        Manager["Manager browser"]
    end

    subgraph Edge["docker network: edge"]
        Web["webserver (nginx)\nserves both SPAs\nonly published port"]
    end

    subgraph Data["docker network: data"]
        PG[("Postgres")]
        Redis[("Redis")]
        Minio[("MinIO")]
        Nats{{"NATS (+ websocket)"}}
    end

    API["api (Express)"]
    Encoder["encoder (Node + ffmpeg)"]

    Listener -->|HTTP| Web
    Manager -->|HTTP + NATS-ws| Web

    Web -->|"/api/*"| API
    Web -->|"/master.m3u8, *.ts (HLS)"| Encoder
    Web -->|"/realtime (NATS-ws, subscribe-only)"| Nats
    Web -->|"/live-mic (websocket)"| Encoder

    API --> PG
    API --> Redis
    API -->|"presigned URLs"| Minio
    API <-->|"cmd/control publish, status subscribe"| Nats

    Encoder -->|"GET /internal/playback/next"| API
    Encoder <-->|"cmd subscribe, status publish"| Nats
    Encoder -->|"writes HLS segments"| Web
```

Two Docker networks enforce the trust boundary: **`data`** (Postgres, Redis, MinIO, NATS) is never reachable from the
public internet, and only `api`/`encoder` bridge into it. **`edge`** carries only what nginx needs to reach
(`webserver`, plus `api`/`encoder`/`nats`, which all also join `edge` for exactly the proxied paths above). MinIO in
particular is never reached by a browser or by the encoder directly — uploads/reads go through the API, and the
encoder only ever receives a short-lived presigned URL.

### Components

| Component | Tech | Role |
|---|---|---|
| `apps/api` | Express + TypeScript 7 + Prisma 7 | Internal API: auth, library, scheduling, clock wheels, queue resolution, NATS command publishing, encoder-facing callback |
| `apps/encoder` | Node + TypeScript 7, orchestrates `ffmpeg` | Produces the live HLS stream; mixes queue/jingle/mic/relay audio; NATS command/status |
| `apps/control-panel` | React 19 + Vite 8 + Tailwind | Manager UI: library, queue, schedule, clock wheels, live mic, settings |
| `apps/player` | React 19 + Vite 8 + Tailwind | Public listener page: HLS playback + now-playing metadata |
| `apps/webserver` | nginx | Single public entry point: static SPAs, API/HLS/NATS-ws/live-mic-ws reverse proxy |
| `packages/shared-types` | Zod schemas | Wire contract shared by api/control-panel/encoder: DTOs + NATS subjects/payloads |
| `packages/database` | Prisma 7 | Schema, migrations, seed script, driver-adapter-based `PrismaClient` singleton |
| Postgres | — | Metadata, schedule, history, users |
| Redis | — | Now-playing cache for the public player |
| MinIO | S3-compatible | Song/jingle/cover-art storage (internal only; swappable for any S3-compatible provider) |
| NATS | — | Realtime command/status bus, with websocket for the browser |

## Repository layout

```
apps/
  api/              Express API (see apps/api/src/modules for each route group)
  encoder/          ffmpeg orchestrator (see apps/encoder/src/{core,sources,process,controllers})
  control-panel/    Manager UI (Vite + React + Tailwind)
  player/           Public listener page (Vite + React + Tailwind)
  webserver/        nginx config + Dockerfile (no application code)
packages/
  shared-types/     DTOs + NATS subject/payload contracts (zod), used by api/control-panel/encoder
  database/         Prisma schema, migrations, seed script
  config/typescript/ Shared tsconfig bases
infra/docker/nats/  NATS server config (auth + websocket)
docker-compose.yml           Base stack definition
docker-compose.override.yml  Auto-merged for local dev (hot reload, host ports for DB/MinIO/NATS)
docker-compose.prod.yml      Explicit -f only: restart policies, no dev conveniences
.env.example                 Every env var, documented, safe to commit
```

## Prerequisites

- Docker and Docker Compose (v2 CLI, i.e. `docker compose`, not `docker-compose`)
- Node.js 22+ and `corepack`/`pnpm` — only needed if you want to run commands (typecheck, migrations) outside Docker
- Nothing else — Postgres/Redis/MinIO/NATS/ffmpeg all run inside containers

## Getting started (local development)

```bash
cp .env.example .env
# edit .env: at minimum change every "change-me" password/secret

pnpm install    # optional, only needed for local typecheck/prisma CLI use outside docker
pnpm run dev
```

`pnpm run dev` is the single entry point for day-to-day development: it runs `docker compose --profile dev-hmr up
--build`, which brings up the **entire** stack with hot reload everywhere —

- `api`/`encoder` run from source inside their containers (`tsx watch`, bind-mounted source) via the base
  `docker-compose.override.yml` merge, no profile needed;
- `control-panel-dev`/`player-dev` additionally start (that's what the `dev-hmr` profile activates) — real Vite dev
  servers with HMR, reachable at `http://localhost:5173/manage/` and `http://localhost:5174/`;
- the one-shot `control-panel-build`/`player-build`/`webserver` path *also* still runs alongside (harmless, just a
  few extra seconds of build time), so the static, production-like build stays available at
  `http://localhost:8000/` / `http://localhost:8000/manage/` too — useful for checking what an actual deploy would
  look like without leaving dev mode.

It runs in the foreground (streaming every container's logs) — `Ctrl+C` stops everything, or run `pnpm run dev:down`
from another terminal. If you'd rather run detached without the frontend HMR containers,
`docker compose up -d --build` (no `--profile`) still works exactly the same way it always did.

> **Don't run `pnpm dev` (or `vite`/`tsx watch`) directly *inside* `apps/api` or `apps/encoder`.** Their
> `DATABASE_URL`/`REDIS_URL`/`NATS_URL` use Docker-internal hostnames (`postgres`, `redis`, `nats`) that only resolve
> from inside the Compose network, and the Dockerized containers already occupy ports 3000/8080. Both apps do load
> `.env` automatically now (via `tsx`'s `--env-file-if-exists`) for one-off host-side scripts (e.g. `prisma studio`,
> ad hoc queries), but their actual dev servers are meant to run inside `docker compose up`/`pnpm run dev`, not
> standalone. `apps/control-panel`/`apps/player`, by contrast, are perfectly fine to run raw on the host if you
> prefer (`pnpm --filter @spectado/control-panel dev`) — their dev proxy targets `localhost:3000`, which *is*
> reachable from the host since Docker publishes that port; that's exactly what the `dev-hmr` profile's containers
> do too, just inside Docker for a consistent environment across machines.

The database schema is **not** created automatically the very first time — generate and apply the initial migration
once against the running Postgres:

```bash
DATABASE_URL="postgresql://radio:change-me@localhost:5432/radio?schema=public" \
  pnpm --filter @spectado/database exec prisma migrate dev --name init
```

(Match the user/password/db to whatever you set in `.env`.) This commits real migration files under
`packages/database/prisma/migrations/` — from then on, the `api-migrate` service applies them automatically on every
`docker compose up` via `prisma migrate deploy`, including for anyone else who clones the repo.

Seed an admin user and baseline data:

```bash
docker compose exec api sh -c "pnpm --filter @spectado/database db:seed"
```

Uses `SEED_ADMIN_USERNAME`/`SEED_ADMIN_PASSWORD` from `.env` (defaults to `admin` / `change-me`).

Then open:

- Player: `http://localhost/`
- Control panel: `http://localhost/manage/` (log in with the seeded admin user)
- Live HLS stream directly: `http://localhost/master.m3u8`
- API health: `http://localhost/api/healthz`

If port 80 is already taken on your machine, see [Troubleshooting](#troubleshooting) — don't edit
`docker-compose.yml` for this, set `WEBSERVER_HOST_PORT` in `.env` instead.

For live-reloading frontend dev servers (Vite HMR) instead of the static build, opt into the `dev-hmr` profile:

```bash
docker compose --profile dev-hmr up -d control-panel-dev player-dev
```

## Deployment

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

`docker-compose.prod.yml` is never auto-merged — it only adds `restart: unless-stopped` policies and disables dev
conveniences. Before deploying anywhere real:

- Rotate every secret in `.env` (`.env.example` marks them all with `change-me` placeholders) — Postgres/Redis/MinIO
  passwords, the three NATS user passwords, `JWT_SECRET`, `ENCODER_CALLBACK_TOKEN`.
- Set `PUBLIC_BASE_URL` to your real public origin (used both for cookie/CORS-adjacent behavior and to generate the
  correct `ws(s)://` NATS URL handed to the control panel).
- TLS is **not** handled by this stack's nginx config — terminate TLS in front of it (a cloud load balancer, Caddy,
  or a Certbot sidecar mounting certs into the `webserver` container) and have that forward plain HTTP to
  `webserver`'s port 80.
- Run the migration + seed steps from [Getting started](#getting-started-local-development) once against the
  production database (the seed script is idempotent — safe to re-run).
- MinIO can be swapped for any S3-compatible provider by changing `S3_ENDPOINT` (and credentials) only — the API
  uses the AWS SDK v3 with `forcePathStyle`, not a MinIO-specific client.

## Configuration reference

All environment variables are documented in `.env.example`. Notable ones:

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | api, encoder migration tooling | Standard Prisma/Postgres connection string |
| `S3_ENDPOINT`, `S3_BUCKET` | api | MinIO today; any S3-compatible endpoint works |
| `API_NATS_PASSWORD` / `ENCODER_NATS_PASSWORD` / `CONTROL_PANEL_NATS_PASSWORD` | nats, api, encoder | Per-role NATS credentials; permissions enforced server-side in `infra/docker/nats/nats-server.conf.template` |
| `ENCODER_CALLBACK_TOKEN` | api, encoder | Shared secret guarding `GET /internal/playback/next` |
| `JWT_SECRET` | api | Signs the httpOnly access/refresh cookies issued on login |
| `PUBLIC_BASE_URL` | api, webserver | Public origin; drives the generated `env-config.js` and the NATS-ws URL handed to the control panel |
| `WEBSERVER_HOST_PORT` | webserver | Host port nginx binds to (default `80`) — change if that port is already taken locally |

## NATS subject contract

Defined once in `packages/shared-types/src/nats/subjects.ts` and enforced at the NATS auth layer
(`infra/docker/nats/nats-server.conf.template`) so each role can only do what it's supposed to:

| Namespace | Publisher | Subscribers | Purpose |
|---|---|---|---|
| `radio.encoder.cmd.*` | api | encoder | Commands: advance/skip, set mode, play/stop jingle, start/stop live mic, start/stop/cancel external relay |
| `radio.encoder.status.*` | encoder | api, control-panel (read-only) | Telemetry: now-playing, queue-advanced, jingle/live/relay start-stop, errors, heartbeat, command acks |
| `radio.control.*` | api | control-panel (read-only) | API-originated broadcasts not sourced from the encoder: mode confirmation, queue-updated signal, alerts |

The control panel's browser NATS credential is **subscribe-only** across the board — every command flows
browser → authenticated HTTP → API → NATS, never browser → NATS directly, so every command is authorized and
audit-logged (`CommandAuditLog` in Postgres) server-side.

## Implementation status

This scaffold prioritized getting real infrastructure wiring working end-to-end over feature completeness. Concretely:

**Real and verified:**
- Full Docker Compose stack (all 6 services + 3 one-shot init containers) builds and boots cleanly from scratch, including the database migration.
- Login (JWT httpOnly cookies), `/auth/me`, NATS-ws credential broker.
- NATS command publishing from the queue skip/start/mode-set endpoints, with audit logging.
- The encoder's full audio pipeline: PCM FIFO → real multi-bitrate ffmpeg HLS encode, continuously producing a
  playable stream (currently a filler tone, since real queue playback isn't implemented yet — see below).
- NATS command/status plumbing, heartbeat, and the encoder's `GET /internal/playback/next` polling loop.
- Public now-playing endpoint (Redis-cached) and the player's HLS playback + polling.

**Stubbed (real routes/modules exist, but return placeholder data or `501 Not Implemented`):**
- Library upload (file streaming to MinIO, tag extraction) — reads are real, writes are not.
- Queue resolution algorithm (one-off schedule → clock wheel → separation rules → fallback) — currently always
  returns a "silence, queue empty" directive.
- Clock wheels, scheduling, external streams CRUD.
- Jingle playback, live mic mixing, external relay switching in the encoder — correct interfaces/state machines
  exist, but don't yet act on the NATS commands they receive.

## Troubleshooting

**Port 80 already in use.** Set `WEBSERVER_HOST_PORT=8000` (or any free port) in `.env` and update
`PUBLIC_BASE_URL` to match (e.g. `http://localhost:8000`) — don't edit `docker-compose.yml`'s port mapping directly,
compose merges list fields across `-f` files by concatenation rather than replacement, so a second `ports:` entry
doesn't remove the first.

**API container unhealthy / `NatsError: Authorization Violation`.** Check that every service reading a given NATS
password uses the *same* env var name as `infra/docker/nats/nats-server.conf.template` expects
(`API_NATS_PASSWORD`, `ENCODER_NATS_PASSWORD`, `CONTROL_PANEL_NATS_PASSWORD` — not a generic `NATS_PASSWORD` alias).
After editing the template, `docker compose restart nats` — a bind-mounted config file change doesn't get picked up
by `docker compose up` alone unless the container is actually recreated/restarted.

**`nats` container exits with `variable reference for '...' could not be parsed`.** The NATS container's
`docker-entrypoint.sh` pre-resolves `${VAR}` placeholders in the template via `envsubst` into a fully-quoted config
*before* `nats-server` ever reads it — deliberately, since `nats-server`'s own `$VAR` substitution is unreliable for
arbitrary secrets (a quoted `"$VAR"` reference silently doesn't substitute at all; an unquoted one substitutes raw
text that then breaks the moment a generated password happens to start with a digit, since its parser tries to read
it as a number). If you see this error, something is bypassing that entrypoint (e.g. the image wasn't rebuilt after
a change to `infra/docker/nats/`) — run `docker compose build nats && docker compose up -d nats`.

**`webserver` exits with `host not found in upstream`.** nginx resolves a `proxy_pass` hostname once at config-load
time by default and hard-crashes if that container isn't registered on the network yet — a real startup race, since
`encoder` (connects NATS, spawns ffmpeg, opens the FIFO) can take longer to come up than `webserver` does. The nginx
config uses Docker's embedded DNS resolver (`127.0.0.11`) plus a `set $x_upstream ...;` variable per proxied backend
so hostnames are re-resolved lazily per-request instead of once at boot — `docker-compose.yml` also lists `nats`/
`encoder` in `webserver`'s `depends_on` as a first line of defense. If you add another proxied backend, follow the
same pattern (`set` the variable, *then* any `rewrite ... break`, *then* a `proxy_pass` with no trailing URI) — see
the next entry for why the ordering matters.

**`/api/*` returns nginx's own error page instead of the API's response** (e.g. a raw 500 "invalid URL prefix", or
every request landing on the same route regardless of path). This is the classic nginx pitfall that comes with using
a variable in `proxy_pass` (done here for the lazy-DNS reason above): a variable disables nginx's normal "replace the
matched location prefix" URI rewriting, so `proxy_pass http://$var/;` would forward the literal path `/` for *every*
request, dropping the actual path entirely. The fix already in place is `rewrite ^/api/(.*)$ /$1 break;` followed by
a `proxy_pass` with no URI part (so it just forwards the already-rewritten current request URI) — but the `set` for
the variable must come **before** the `rewrite ... break`, not after, since `break` halts all further rewrite-phase
directives in that location block, `set` included. Getting this order backwards produces "using uninitialized
variable" warnings in `docker compose logs webserver` and a 500 on every request.

**Control panel / player loads `index.html` but its JS/CSS 404 (`/manage/assets/index-*.js`).** This bit us once for
real, not just in theory: a single generic `location ~* \.(js|css|...)$ { add_header ...; }` meant to add long-cache
headers to hashed assets will **win over** the SPA's own `location /` or `location /manage/` prefix block — nginx
always prefers a regex location over a prefix location regardless of file order — and since that regex location
defines no `root`/`alias` of its own, it falls back to nginx's compiled-in default document root instead of either
SPA's real one, 404ing every asset. The fix is two *path-scoped* regex locations (`^/assets/...` for the player,
`^/manage/assets/...` for the control panel), each with its own explicit `alias` using the regex capture group. If
you add a third static app, give its hashed-asset location the same treatment rather than reaching for one generic
catch-all regex.

**Vite dev container (`control-panel-dev`/`player-dev`) starts but is unreachable on its published port.** Check
`docker compose logs control-panel-dev` for `Network: use --host to expose` — that means Vite is still only bound to
the container's own localhost, so the `5173:5173`/`5174:5174` port mapping has nothing to connect to. `--host` was
originally passed via Compose's exec-form `command: [..., "dev", "--", "--host"]`, but passing extra args through a
`pnpm run <script> -- <args>` array this way didn't reliably strip pnpm's own `--` separator, so `--host` reached
Vite as a literal, unrecognized argument. Fixed by baking `--host` directly into each app's own `"dev": "vite
--host"` script instead of passing it through Compose at all.

**Login "succeeds" (200 + user JSON) but every subsequent request 401s** (`missing access token`, or the control
panel shows "Connection error" / can't skip/start/reach `/auth/me`). The whole stack runs over plain HTTP in dev
(`http://localhost:8000`, or `:5173`/`:5174` for the Vite HMR servers), but the auth cookies were being set with
`secure: true` unconditionally. A `Secure` cookie isn't just "not sent" over HTTP — some browsers (confirmed in
Safari) refuse to **store** it at all, so the login response looks fine but the browser never actually keeps the
session. Fixed by making it `secure: config.isProduction` in `apps/api/src/modules/auth/auth.routes.ts` (only
HTTPS-only in production, where TLS is terminated in front of nginx per the Deployment section). Check with
`curl -sD - -o /dev/null -X POST .../api/auth/login ... | grep -i set-cookie` — in dev it should show `HttpOnly;
SameSite=Strict` with **no** `Secure`.

**`/manage` (no trailing slash) silently shows the player app instead of the control panel**, or a
**`WebSocket connection to 'ws://.../realtime' failed: bad response from the server`**. Same underlying cause both
times: nginx's `location /manage/` and `location /realtime/` are prefix matches that require the trailing slash to
already be part of the request URI — a bare `/manage` or `/realtime` doesn't match either and falls through to the
player SPA's `location /` instead, which returns a normal 200 HTML response (not a 101 WebSocket upgrade). The two
cases needed *different* fixes: `/manage` got an explicit `location = /manage { return 301 $scheme://$http_host/manage/; }`
redirect (note `$http_host`, not `$host` — `$host` drops the port, and nginx would otherwise build the redirect
against its own internal listening port rather than the externally-mapped `WEBSERVER_HOST_PORT`). `/realtime`
could **not** use a redirect — WebSocket clients don't follow HTTP redirects during the handshake — so that one had
to be fixed at the source instead: `apps/api/src/modules/realtime/realtime.routes.ts` now hands out
`ws://.../realtime/` (trailing slash included) rather than relying on nginx to correct it after the fact. If you add
another trailing-slash-sensitive location, decide up front whether anything connecting to it is a WebSocket — if so,
skip the redirect trick entirely and fix the URL at its source instead.

**Edited `apps/api` or `apps/encoder` source but the running dev container doesn't reflect it.** `tsx watch` relies
on filesystem-change events, and Docker Desktop's bind-mount file sharing doesn't always propagate host-side edits
into the container reliably. If `docker compose exec <service> cat <file>` shows your edit but the behavior hasn't
changed, don't assume the fix is wrong — `docker compose restart <service>` first to rule out a stale process before
debugging further.

**After bumping a dependency, `api`/`encoder` crash with `Cannot find package '...'` even though it's in
`package.json` and `pnpm install` succeeded.** Check whether the anonymous volumes for that service's `node_modules`
(`docker-compose.override.yml`'s `- "/workspace/node_modules"` / `- "/workspace/apps/.../node_modules"`) are stale.
Docker Compose does **not** recreate anonymous volumes just because you rebuilt the image or ran `pnpm install` on
the host — they persist across `docker compose up`/`restart`/plain image rebuilds, silently shadowing the freshly
built image's `node_modules` with whatever was there when the volume was first created. Force-renew them:
`docker compose up -d --force-recreate --renew-anon-volumes <service>`. This bit us for real during the
TypeScript 7/Prisma 7/Vite 8/React 19 upgrade — `@prisma/adapter-pg` was correctly installed and correctly present
in the fresh image, but the running dev container still couldn't resolve it until the anon volume was renewed.

**Migrating Prisma major versions (e.g. the 6→7 jump this project already made).** A few non-obvious, verified-the-
hard-way changes if you're bumping further: (1) `datasource { url = env(...) }` in `schema.prisma` is now a hard
validation error (`P1012`) — the connection URL lives *only* in `prisma.config.ts` (`packages/database/prisma.config.ts`)
now. (2) That config file's `datasource.url` is evaluated for **every** Prisma command, including `generate`, which
never needed a real connection before — reading `process.env.DATABASE_URL` directly with a placeholder fallback
(rather than the stricter `env()` helper, which throws on a missing var) is what keeps `generate` working during
`docker build` (no `DATABASE_URL` at build time) and plain `pnpm turbo run typecheck` on a bare host. (3) The
`prisma-client` generator (replacing `prisma-client-js`) outputs plain, uncompiled `.ts` files to your chosen
`output` path (e.g. `packages/database/generated/prisma/client.ts`) — no `package.json`/`exports` field, so import it
by its actual file path (with this repo's usual `.js`-suffixed relative-import convention), not as if it were an
installed package. (4) The generated client's *internals* still import `@prisma/client` for shared runtime helpers
even though your own code no longer needs to — don't remove it from `package.json` just because nothing you wrote
imports it directly. (5) A driver adapter (`@prisma/adapter-pg` here) is mandatory — `new PrismaClient()` with no
arguments no longer works at all.

**`master.m3u8` 404s.** Check `docker compose logs encoder` — the two most likely causes are the PCM FIFO not
existing yet (created by `apps/encoder/docker/entrypoint.sh`, which only runs in the production image stage — the
dev override recreates this step inline in its `command:`) or `ffmpeg` missing from whatever stage the encoder
container is actually running (both the `builder` and `runtime` stages install it, from a shared `base` stage, for
exactly this reason).

**Rotated a password in `.env` and now `api-migrate`/`api` can't authenticate to Postgres.** Postgres (and MinIO)
only use their root password env vars to initialize a *fresh* data volume — changing `.env` and restarting an
already-initialized container does not rotate the real stored credential, it just changes what the *other* services
now try to connect with. Rotate it in place instead of wiping data:
```bash
docker run --rm --network <project>_data -e PGPASSWORD=<old password> postgres:16-alpine \
  psql -h postgres -U radio -d radio -c "ALTER ROLE radio WITH PASSWORD '<new password>';"
```
(Redis is the exception — `requirepass` isn't stored in its persisted data at all, so recreating that one container,
e.g. `docker compose up -d --force-recreate redis`, is enough.)

**`prisma.user... The table does not exist`.** No migration has been generated yet — see the `prisma migrate dev
--name init` step in [Getting started](#getting-started-local-development). `prisma migrate deploy` (what the
`api-migrate` service runs) only *applies* existing migration files, it doesn't generate new ones from the schema.
