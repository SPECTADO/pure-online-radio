# SPECTADO — Pure Online Radio

A self-hosted online radio platform: a manager control panel for running the station, a public player, and an
automated ffmpeg-based encoder that produces a continuous multi-bitrate HLS stream from a scheduled/rotated song
queue, jingles, live mic input, and external stream relays. Everything runs as a single Docker Compose stack.

> **Status:** this repository is currently a **scaffold**. The full infrastructure, data model, and service wiring
> are real and verified working end-to-end (see [Implementation status](#implementation-status)). The manual
> playback queue, standalone jingle overlay, the Schedule/External Streams feature (recurring/one-off
> song-jingle-ad blocks and relay triggers, real scheduler + NATS commands), and Clock Wheels (automatic queue
> filling from day/time rotation rules, with separation-rule enforcement) are now real too — most of what's left
> stubbed is live mic mixing and the encoder's actual external-relay audio decode. See that section before assuming
> a feature works.

## Contents

- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Data model](#data-model)
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
2. **Queue resolution**: the encoder asks the API "what's next" (`GET /internal/playback/next`) whenever it needs to
   advance — at boot, when the current item finishes, on an explicit skip/start, or after a short retry delay while
   the queue is empty. That resolves, in priority order: any due **Schedule** items (real — a recurring/one-off
   song-jingle-ad block fired by its rule, see below) ahead of the **manual queue** (a manager adds any song/jingle/ad
   to a simple FIFO — search on the Queue page, or an "Add to queue" button in each library page), ahead of
   **Clock Wheel** rotation fill (real — a background scheduler tick keeps the queue planned
   `queuePlanningHorizonMinutes` ahead by picking whichever day/time-matched wheel is active, cycling through its
   ordered pick-rule steps, and selecting concrete media per step's category/tag filter, selection strategy, and the
   global artist/album/song separation rules — falling back to the one required Default wheel for any time no other
   active wheel's slot matches). All three tiers drain from the same underlying queue table, one item after another.
   The result is a signed, time-limited MinIO URL the encoder decodes directly via ffmpeg — it never holds storage
   credentials itself. When the queue is empty, the encoder falls back to real silence (not a filler tone).
3. **Encoding**: the encoder mixes whatever should currently be audible (queue track, jingle overlay, live mic
   overlay, or an external relay) into a single continuous PCM bus, which a persistent ffmpeg process encodes into
   two HLS variants (low/high bitrate AAC) written to a shared volume.
4. **Delivery**: nginx is the _only_ public entry point. It serves the built control panel and player SPAs, reverse
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

| Component               | Tech                                          | Role                                                                                                                      |
| ----------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`              | Express 5 + TypeScript 7 + Prisma 7           | Internal API: auth, library, scheduling, clock wheels, queue resolution, NATS command publishing, encoder-facing callback |
| `apps/encoder`          | Node + TypeScript 7, orchestrates `ffmpeg`    | Produces the live HLS stream; mixes queue/jingle/mic/relay audio; NATS command/status                                     |
| `apps/control-panel`    | React 19 + React Router 7 + Vite 8 + Tailwind | Manager UI: library, queue, schedule, clock wheels, live mic, settings                                                    |
| `apps/player`           | React 19 + Vite 8 + Tailwind                  | Public listener page: HLS playback + now-playing metadata                                                                 |
| `apps/webserver`        | nginx                                         | Single public entry point: static SPAs, API/HLS/NATS-ws/live-mic-ws reverse proxy                                         |
| `packages/shared-types` | Zod 4 schemas                                 | Wire contract shared by api/control-panel/encoder: DTOs + NATS subjects/payloads                                          |
| `packages/database`     | Prisma 7                                      | Schema, migrations, seed script, driver-adapter-based `PrismaClient` singleton                                            |
| Postgres                | —                                             | Metadata, schedule, history, users                                                                                        |
| Redis                   | —                                             | Now-playing cache for the public player                                                                                   |
| MinIO                   | S3-compatible                                 | Song/jingle/cover-art storage (internal only; swappable for any S3-compatible provider)                                   |
| NATS                    | —                                             | Realtime command/status bus, with websocket for the browser                                                               |

## Data model

`packages/database/prisma/schema.prisma` is the source of truth — this diagram mirrors it but will drift as the
schema evolves, so treat the schema file as authoritative on conflict. A few cross-cutting patterns worth knowing
before reading it:

- Most models also carry `createdAt` (and, where mutable, `updatedAt`) timestamps; omitted below for brevity.
- `Song`/`Jingle`/`Ad`/`ScheduledItem`/`ClockWheel`/`ScheduleRule`/`ExternalStream`/`PlaybackHistoryEntry` all carry
  a nullable `stationId` — a multi-station scaffold reserved for a future release, unused in v1.
- `ScheduleRule` and `ExternalStream` share the same trigger scalar fields (`triggerType`, `insertionMode`, `runAt`,
  `weekdays`, `timeOfDay`, `intervalMinutes`, `windowStart`/`windowEnd`, `everyNPlays`/`playsSinceLastTrigger`,
  `lastTriggeredAt`) — duplicated on both models rather than factored into a shared table, consistent with this
  schema's existing preference for flat fields over generic/polymorphic join tables; omitted from the per-model
  field lists below to avoid repeating them twice, see `apps/api/src/lib/scheduleTrigger.ts` for the shared
  read/write mapping.
- `StationSettings`, `ScratchPad`, and the `GLOBAL`-scoped `SeparationRule` are enforced as a single row by the
  application layer (`findFirst`-or-create), not by a DB constraint.
- `isActive` on `Song`/`Jingle`/`Ad` is a soft-disable flag, not a delete — it keeps history/FK references intact.
- `PlaybackHistoryEntry` denormalizes `titleSnapshot`/`artistSnapshot` so playback history stays correct even if the
  source `Song`/`Jingle` is later edited or soft-disabled.

```mermaid
erDiagram
    User |o--o{ Song : "created by"
    User |o--o{ Jingle : "created by"
    User |o--o{ Ad : "created by"
    User ||--o{ ScheduledItem : "created by"
    User ||--o{ ScheduleRule : "created by"
    User ||--o{ ExternalStream : "created by"
    User |o--o{ SeparationRule : "last updated by"
    User |o--o{ StationSettings : "last updated by"
    User |o--o{ ScratchPad : "last updated by"
    User |o--o{ StreamSettings : "last updated by"
    User |o--o{ CommandAuditLog : "issued by"

    Category }o--o{ Song : categorizes
    Category }o--o{ Jingle : categorizes
    Category }o--o{ Ad : categorizes
    Category |o--o{ ClockWheelStep : filters

    Song |o--o{ ScheduledItem : queues
    Jingle |o--o{ ScheduledItem : queues
    Ad |o--o{ ScheduledItem : queues

    Song |o--o{ ScheduleRuleItem : queues
    Jingle |o--o{ ScheduleRuleItem : queues
    Ad |o--o{ ScheduleRuleItem : queues
    ScheduleRule ||--o{ ScheduleRuleItem : contains
    ScheduleRule |o--o{ ScheduledItem : "materializes (fires)"

    Song |o--o{ PlaybackHistoryEntry : plays
    Jingle |o--o{ PlaybackHistoryEntry : plays
    Ad |o--o{ PlaybackHistoryEntry : plays
    ExternalStream |o--o{ PlaybackHistoryEntry : plays
    ScheduledItem |o--o{ PlaybackHistoryEntry : plays
    ClockWheelStep |o--o{ PlaybackHistoryEntry : "picked via"
    ClockWheelStep |o--o{ ScheduledItem : "fills (clock-wheel rotation)"

    ClockWheel ||--o{ ClockWheelSlot : schedules
    ClockWheel ||--o{ ClockWheelStep : contains
    ClockWheel |o--o{ SeparationRule : scopes

    User {
        string id PK
        string username UK
        Role role
        boolean isActive
    }

    Category {
        string id PK
        string name UK
    }

    Song {
        string id PK
        string title
        string artist
        string album
        int durationMs
        string fileKey UK
        string coverArtKey
        string tags "array"
        boolean isActive
        string createdById FK
    }

    Jingle {
        string id PK
        string title
        JingleType type
        string tags "array"
        int durationMs
        string fileKey UK
        boolean isActive
        string createdById FK
    }

    Ad {
        string id PK
        string title
        int durationMs
        string fileKey UK
        datetime activeFrom
        datetime activeUntil
        boolean isActive
        string createdById FK
    }

    ScheduledItem {
        string id PK
        datetime scheduledFor
        int position
        MediaKind mediaKind
        string songId FK
        string jingleId FK
        string adId FK
        ScheduledItemStatus status
        string scheduleRuleId FK
        string clockWheelStepId FK
        string createdById FK
        datetime playedAt
    }

    ScheduleRule {
        string id PK
        string name
        boolean isActive
        string createdById FK
    }

    ScheduleRuleItem {
        string id PK
        string scheduleRuleId FK
        int order
        MediaKind mediaKind
        string songId FK
        string jingleId FK
        string adId FK
    }

    ClockWheel {
        string id PK
        string name
        boolean isActive
        boolean isDefault
        int rotationCursor
    }

    ClockWheelSlot {
        string id PK
        string clockWheelId FK
        int weekdays "array, 0=Sun"
        time startTime
        time endTime
    }

    ClockWheelStep {
        string id PK
        string clockWheelId FK
        int order
        MediaKind mediaKind
        SelectionStrategy selectionStrategy
        string categoryId FK
        string tag
    }

    SeparationRule {
        string id PK
        SeparationRuleScope scope
        string clockWheelId FK
        int artistSeparationMinutes
        int albumSeparationMinutes
        int songSeparationMinutes
        string updatedById FK
    }

    StationSettings {
        string id PK
        string name
        string description
        string logoKey
        json links
        string timeFormat
        int queuePlanningHorizonMinutes
        string updatedById FK
    }

    ScratchPad {
        string id PK
        json slots
        string updatedById FK
    }

    StreamSettings {
        string id PK
        StreamCodec codec
        int lowBitrateKbps
        int highBitrateKbps
        int segmentSeconds
        int segmentCount
        boolean lowLatencyEnabled
        string updatedById FK
    }

    ExternalStream {
        string id PK
        string name
        string url
        ExternalStreamStatus status
        ExternalStreamEndBehavior endBehavior
        datetime endAt
        int durationMs
        datetime startedAt
        string createdById FK
    }

    PlaybackHistoryEntry {
        string id PK
        PlaybackMediaKind mediaKind
        string songId FK
        string jingleId FK
        string adId FK
        string externalStreamId FK
        PlaybackSource source
        string clockWheelStepId FK
        string scheduledItemId FK
        datetime startedAt
        datetime endedAt
        int durationMs
        string titleSnapshot
        string artistSnapshot
    }

    CommandAuditLog {
        string id PK
        string userId FK
        string commandSubject
        json payload
        string result
        datetime createdAt
    }
```

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
- the one-shot `control-panel-build`/`player-build`/`webserver` path _also_ still runs alongside (harmless, just a
  few extra seconds of build time), so the static, production-like build stays available at
  `http://localhost:8000/` / `http://localhost:8000/manage/` too — useful for checking what an actual deploy would
  look like without leaving dev mode.

It runs in the foreground (streaming every container's logs) — `Ctrl+C` stops everything, or run `pnpm run dev:down`
from another terminal. If you'd rather run detached without the frontend HMR containers,
`docker compose up -d --build` (no `--profile`) still works exactly the same way it always did.

> **Don't run `pnpm dev` (or `vite`/`tsx watch`) directly _inside_ `apps/api` or `apps/encoder`.** Their
> `DATABASE_URL`/`REDIS_URL`/`NATS_URL` use Docker-internal hostnames (`postgres`, `redis`, `nats`) that only resolve
> from inside the Compose network, and the Dockerized containers already occupy ports 3000/8080. Both apps do load
> `.env` automatically now (via `tsx`'s `--env-file-if-exists`) for one-off host-side scripts (e.g. `prisma studio`,
> ad hoc queries), but their actual dev servers are meant to run inside `docker compose up`/`pnpm run dev`, not
> standalone. `apps/control-panel`/`apps/player`, by contrast, are perfectly fine to run raw on the host if you
> prefer (`pnpm --filter @spectado/control-panel dev`) — their dev proxy targets `localhost:3000` by default, which
> _is_ reachable from the host since Docker publishes that port. The `dev-hmr` profile's own `control-panel-dev`/
> `player-dev` containers instead override `VITE_DEV_API_PROXY_TARGET` to `http://api:3000` (see the Troubleshooting
> entry on the dev proxy below) since `localhost` inside those containers means the container itself, not `api`.

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

| Variable                                                                      | Used by                        | Notes                                                                                                                                                                                      |
| ----------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                                                | api, encoder migration tooling | Standard Prisma/Postgres connection string                                                                                                                                                 |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`        | api                            | MinIO today; any S3-compatible endpoint works. All four are required — the library upload routes need a real connection, unlike earlier when nothing in the API actually touched MinIO yet |
| `MUSICBRAINZ_USER_AGENT`                                                      | api                            | Sent on every song metadata search request; MusicBrainz asks for a descriptive value (ideally with a contact URL) instead of an API key                                                    |
| `API_NATS_PASSWORD` / `ENCODER_NATS_PASSWORD` / `CONTROL_PANEL_NATS_PASSWORD` | nats, api, encoder             | Per-role NATS credentials; permissions enforced server-side in `infra/docker/nats/nats-server.conf.template`                                                                               |
| `ENCODER_CALLBACK_TOKEN`                                                      | api, encoder                   | Shared secret guarding `GET /internal/playback/next`                                                                                                                                       |
| `JWT_SECRET`                                                                  | api                            | Signs the httpOnly access/refresh cookies issued on login                                                                                                                                  |
| `PUBLIC_BASE_URL`                                                             | api, webserver                 | Public origin; drives the generated `env-config.js` and the NATS-ws URL handed to the control panel                                                                                        |
| `WEBSERVER_HOST_PORT`                                                         | webserver                      | Host port nginx binds to (default `80`) — change if that port is already taken locally                                                                                                     |

## NATS subject contract

Defined once in `packages/shared-types/src/nats/subjects.ts` and enforced at the NATS auth layer
(`infra/docker/nats/nats-server.conf.template`) so each role can only do what it's supposed to:

| Namespace                | Publisher | Subscribers                    | Purpose                                                                                                   |
| ------------------------ | --------- | ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `radio.encoder.cmd.*`    | api       | encoder                        | Commands: advance/skip, set mode, play/stop jingle, start/stop live mic, start/stop/cancel external relay |
| `radio.encoder.status.*` | encoder   | api, control-panel (read-only) | Telemetry: now-playing, queue-advanced, jingle/live/relay start-stop, errors, heartbeat, command acks     |
| `radio.control.*`        | api       | control-panel (read-only)      | API-originated broadcasts not sourced from the encoder: mode confirmation, queue-updated signal, alerts   |

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
  playable stream — the manual queue's songs/jingles/ads and the standalone jingle overlay are genuinely decoded
  (ffmpeg spawned per item, `-re` real-time-paced, ring-buffered) and mixed onto the bus, not simulated; the encoder
  falls back to real silence (not a filler tone) once the queue is empty.
- **Manual playback queue**: `GET/POST /queue`, `POST/DELETE /queue/items/:id` back a real FIFO (backed by
  `ScheduledItem` with `scheduledFor: null`) that the encoder drains one item after another
  (`apps/encoder/src/controllers/queueController.ts`); `POST /queue/jingle/play|stop` mount/unmount a standalone
  jingle overlay that ducks the primary bus in real time (`core/mixer.ts`'s envelope-driven ducking, one
  `GainEnvelope` drives both the jingle's own fade and the primary bus's duck amount) — independent of what's
  currently in the queue. The control panel's Queue page (search + add + remove) and Dashboard (now-playing +
  up-next + jingle search/play/stop, each with a live mm:ss countdown and progress bar, poll + NATS-pushed) are both
  wired to this for real.
- NATS command/status plumbing, heartbeat (now reporting the mixer's real primary-slot kind/jingle-active/underrun
  state instead of hardcoded placeholders), and the encoder's on-demand `GET /internal/playback/next` fetch (driven
  by the queue controller's advance loop, not a fixed-interval poll — that endpoint has a real dequeue side effect).
- Public now-playing endpoint (Redis-cached) and the player's HLS playback + polling.
- **Songs/jingles/ads library** — full upload/edit/delete for all three media kinds, each in its own MinIO
  key prefix (`songs/{id}/`, `jingles/{id}/`, `ads/{id}/`). ID3 tag extraction (`music-metadata`) auto-fills
  title/artist/album/duration on upload, editable afterward; embedded ID3 cover art is auto-extracted, or a
  cover image can be uploaded/replaced separately. Categories are user-defined and many-to-many (a song/jingle
  can belong to several); every song and jingle is always additionally attached to the fixed "ALL" category,
  and ads are _only_ ever attached to "ALL" (no user choice — see `ads.routes.ts`). Ads additionally carry a
  mandatory `activeFrom`/`activeUntil` window in the schema, enforced by request validation and by the clock-wheel
  fill engine (below), which excludes an ad from an AD-kind step's candidates outside its active window. Song
  metadata can also be
  looked up externally via MusicBrainz + the Cover Art Archive (free, no API key) and applied with one click —
  see `apps/api/src/modules/library/metadataProviders/musicBrainzProvider.ts` for why that provider was picked
  and what's deliberately not built (audio-fingerprint auto-identification via AcoustID/Chromaprint).
- **Dashboard scratch pad** — a 2×5 grid of manager-assignable jingle shortcut buttons on the Dashboard (right
  panel), each triggering the same real jingle-overlay play as the quick search. Assignments are configured on the
  new Settings → Scratch Pad page and persist to a `ScratchPad` singleton row (`GET/PUT /settings/scratch-pad`,
  same findFirst-or-create pattern as `StationSettings`). The big OFF/AUTO/MANUAL pill is a real button (click to
  toggle `POST /queue/mode`, disabled while OFF/silence); the ON AIR/off air pill calls the real (still-stubbed)
  `POST /live-mic/session` endpoint and surfaces its 501 like any other not-yet-built action — there's no real
  live-mic session to read until that feature (below) is built, so it always reads "off air" today.
- **12h/24h clock format** — a station-wide display preference (`StationSettings.timeFormat`, Settings → Station
  Settings → Display), read via `useTimeFormat()` and applied everywhere a clock time is rendered (Dashboard,
  Queue, Schedule, Ads, External Streams, Separation Rules).
- **Schedule** (`ScheduleRule`/`ScheduleRuleItem`) — manager-defined blocks of one or more songs/jingles/ads,
  triggered by a specific date/time, a weekly day+time, a recurring interval (optionally within a daily window), or
  every N songs played, each with an `ASAP` (finish the current item first) or `AT_TIME` (interrupt immediately)
  insertion mode. A scheduler tick (`apps/api/src/scheduler/`, every 15s, plus an event-driven hook for the
  play-count trigger) evaluates due rules, materializes `ScheduledItem` rows (which `GET /internal/playback/next`
  now prefers over the manual queue), and — for `AT_TIME` — publishes a real `advance` command to interrupt
  playback immediately. Full CRUD + an ordered drag-to-reorder item picker on the Schedule page.
- **External Streams** (`ExternalStream`) — the same trigger/insertion model as Schedule, plus an independent end
  behavior: stop naturally (on-demand EOF or a live disconnect, reported by the encoder's `relay.ended` status) or
  force-stop at an absolute time or after a duration. The same scheduler tick publishes real, audited
  `relay.start`/`relay.stop` NATS commands at the right moment (verified end-to-end: `relayStart`'s `endAt` is
  computed correctly for `AFTER_DURATION`, and the forced `relayStop` fires exactly on schedule). The encoder
  receiving and acknowledging these commands is real; it decoding the relay URL into actual audio is not (see
  Stubbed, below) — that's a separate, pre-existing gap in the audio pipeline, not in the scheduling logic.
- **Clock Wheels** (`ClockWheel`/`ClockWheelSlot`/`ClockWheelStep`) — the lowest-priority queue-fill tier: one
  required **Default** wheel (seeded, never deletable, no day/time window of its own) plus any number of
  manager-defined wheels, each with one or more weekday+time-range slots (midnight-wraparound slots handled, e.g. a
  22:00–06:00 night show) and an ordered rotation of pick-rule steps (song/jingle/ad, an optional category-or-all
  and tag filter, and a selection strategy — `RANDOM`, `LEAST_RECENTLY_PLAYED`, or `WEIGHTED_RECENCY`, written as a
  dispatch table so more strategies can be added later). Full CRUD (`apps/api/src/modules/clockWheels/`) rejects
  overlapping slots between active, non-default wheels so at most one ever matches a given moment. Every 15s
  scheduler tick (`apps/api/src/scheduler/clockWheelEngine.ts`) keeps the queue filled
  `queuePlanningHorizonMinutes` ahead (Settings → Station Settings, default 4h): it picks the wheel active at each
  estimated future moment, cycles that wheel's steps via a persisted `rotationCursor`, and selects concrete media
  respecting the **Separation Rules** (Settings → Separation Rules: artist/album/song minimums, checked against
  both real playback history and whatever the engine has already planned later in the same fill pass — not just
  past plays — progressively relaxed if nothing survives, so a slot is never left unfilled just because rotation
  variety can't be perfectly honored). `internal/playback/next`'s claim now has 3 tiers — due Schedule items, then
  the manual queue, then clock-wheel fill — the clock-wheel tier claimed strictly FIFO rather than gated on its
  estimated time, so real playback drift (skips, interruptions) can never open a silence gap. `PlaybackHistoryEntry`
  is now actually written (at claim time, for every source) — the durable log the separation rules and
  `LEAST_RECENTLY_PLAYED`/`WEIGHTED_RECENCY` strategies read from. The Clock Wheels page shows a visual weekly
  grid of which wheel is active when (default wheel as the base fill color, specific wheels as colored blocks);
  the Queue/Dashboard "Up Next" views tag clock-wheel-filled rows "Rotation" to distinguish them from manual/
  scheduled items.
- **Stream Settings** (`StreamSettings`, Settings → Stream Settings) — codec (AAC/MP3), low/high variant bitrate,
  HLS segment length + segment count (the live-edge/time-shift/DVR window is `segmentSeconds × segmentCount`), and a
  **real** Low Latency HLS toggle. The encoder fetches this singleton row once at boot (`GET
  /internal/stream-settings`, retried a few times, falling back to the pipeline's original hardcoded values if the
  API never answers) and picks its pipeline from it — there is no live-reload path, so a saved change only takes
  effect the next time the encoder process restarts (the settings page says so). Orphaned segments that could
  previously accumulate forever across encoder crash-restarts (a muxer's own segment-deletion logic only prunes
  segments *its own* process created — a fresh process after a crash never knew about the previous one's files) are
  fixed by wiping and recreating the output directories on every (re)spawn of either pipeline below, not just the
  initial boot.

  **Two genuinely different pipelines, selected by `lowLatencyEnabled`** (`apps/encoder/src/index.ts` constructs
  one or the other, never both):
  - **Standard** (`lowLatencyEnabled: false`) — `apps/encoder/src/process/masterEncoder.ts`, unchanged from before
    this feature: a single ffmpeg process does encode *and* HLS muxing (`-f hls`, mpegts segments) in one step.
  - **Low Latency HLS** (`lowLatencyEnabled: true`) — `apps/encoder/src/process/llHlsEncoder.ts`, a real,
    spec-compliant LL-HLS pipeline (`EXT-X-PART`/`EXT-X-PRELOAD-HINT`, byte-range parts), *not* the old
    reduced-segment-length approximation this feature originally shipped with. ffmpeg's own HLS muxer has zero
    partial-segment capability (verified directly against `ffmpeg -h muxer=hls`, not assumed) and no ffmpeg version
    or build flag adds it — that finding is what justified reaching for a second tool rather than a
    ./configure/recompile. Of the real alternatives investigated, Shaka Packager only implements low-latency
    **DASH**, not HLS; **GPAC** (the `gpac` CLI) is the one that genuinely implements the modern spec. The pipeline
    is one ffmpeg process (encode-only, no muxing — asplits into the two bitrate variants same as the standard
    pipeline, writes ADTS AAC into two named FIFOs) feeding a single `gpac` process (one dasher invocation, two
    `-i` inputs each tagged with its own `#Bandwidth`/`#HLSPL`, `llhls=br` for byte-range parts) that produces the
    master playlist and both variant playlists/segments together. The two processes are supervised as one atomic
    group (`LowLatencyEncoder`, generalizing `ProcessSupervisor`'s crash/backoff shape to a pair that depends on
    each other) since either one dying alone just stalls the other rather than recovering cleanly. Requires the AAC
    codec (enforced by `UpdateStreamSettingsRequestSchema`'s validation) — MP3-in-fMP4 isn't part of Apple's HLS
    authoring spec. `gpac` has no Debian/Ubuntu package at all, so `apps/encoder/Dockerfile` builds it from source
    (`--static-bin`, ~40s, fully static binary per `ldd` — nothing extra needed at runtime) in its own stage rather
    than installing a build toolchain into the final image.

  All of the above (multi-input single-`gpac`-process dashing, a from-source build against this project's exact
  Debian bookworm-slim base, and plain static nginx correctly serving byte-range `Range` requests against a segment
  file `gpac` is still actively appending to) was verified empirically in a standalone spike before writing any of
  the real integration — including the two non-obvious gotchas it surfaced: GPAC's own doc example chains
  `reframer:rt=on` onto an already real-time-paced source, which double-regulates timing and silently balloons
  latency (measured ~18s) — don't do that when ffmpeg is already pacing the feed; and a FIFO bind-mounted from the
  **host** into a container doesn't reliably cross the Docker Desktop macOS boundary (silent no-op, not an error) —
  only same-container FIFOs (what `LowLatencyEncoder` actually uses) are safe here. Not implemented: blocking
  playlist reload (`_HLS_msn`/`_HLS_part`) — plain static nginx can't do that by design, so clients fall back to
  polling, which is spec-legal but not maximally optimal; and no real browser/hls.js playback test (no browser
  automation available in the environment this was built in) — the manifest correctness and byte-range serving were
  verified directly instead (real `EXT-X-PART`/`BYTERANGE`/`EXT-X-PRELOAD-HINT` tags, `ffprobe`-decoded audio).

**Stubbed (real routes/modules exist, but return placeholder data or `501 Not Implemented`):**

- Live mic mixing, external relay audio decode in the encoder (`apps/encoder/src/sources/relaySource.ts`,
  `controllers/relayController.ts`) — correct interfaces/state machines exist, and `relayController` now receives
  correctly-shaped `relay.start`/`relay.stop`/`relay.cancel` commands (see External Streams, above), but doesn't yet
  act on them to produce real audio (jingle playback is the one overlay that's real now).

## Troubleshooting

**Port 80 already in use.** Set `WEBSERVER_HOST_PORT=8000` (or any free port) in `.env` and update
`PUBLIC_BASE_URL` to match (e.g. `http://localhost:8000`) — don't edit `docker-compose.yml`'s port mapping directly,
compose merges list fields across `-f` files by concatenation rather than replacement, so a second `ports:` entry
doesn't remove the first.

**API container unhealthy / `NatsError: Authorization Violation`.** Check that every service reading a given NATS
password uses the _same_ env var name as `infra/docker/nats/nats-server.conf.template` expects
(`API_NATS_PASSWORD`, `ENCODER_NATS_PASSWORD`, `CONTROL_PANEL_NATS_PASSWORD` — not a generic `NATS_PASSWORD` alias).
After editing the template, `docker compose restart nats` — a bind-mounted config file change doesn't get picked up
by `docker compose up` alone unless the container is actually recreated/restarted.

**`nats` container exits with `variable reference for '...' could not be parsed`.** The NATS container's
`docker-entrypoint.sh` pre-resolves `${VAR}` placeholders in the template via `envsubst` into a fully-quoted config
_before_ `nats-server` ever reads it — deliberately, since `nats-server`'s own `$VAR` substitution is unreliable for
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
same pattern (`set` the variable, _then_ any `rewrite ... break`, _then_ a `proxy_pass` with no trailing URI) — see
the next entry for why the ordering matters.

**`/api/*` returns nginx's own error page instead of the API's response** (e.g. a raw 500 "invalid URL prefix", or
every request landing on the same route regardless of path). This is the classic nginx pitfall that comes with using
a variable in `proxy_pass` (done here for the lazy-DNS reason above): a variable disables nginx's normal "replace the
matched location prefix" URI rewriting, so `proxy_pass http://$var/;` would forward the literal path `/` for _every_
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
SPA's real one, 404ing every asset. The fix is two _path-scoped_ regex locations (`^/assets/...` for the player,
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

**Vite dev container is reachable but every `/api/*` call 404s or the browser can't reach the API at all
(`ECONNREFUSED`/502 through the `:5173`/`:5174` proxy).** Two separate bugs, both hit for real:

1. `apps/control-panel/vite.config.ts` and `apps/player/vite.config.ts`'s dev proxy forwarded `/api/*` verbatim, but
   the api app mounts routes at the bare path (`/auth`, `/queue`, `/public`, ...) — nginx strips the `/api` prefix in
   production (see the `webserver` entry above), so the dev proxy needs the same `rewrite: (path) =>
   path.replace(/^\/api/, "")` or every request 404s against the api.
2. `VITE_DEV_API_PROXY_TARGET` defaults to `http://localhost:3000`, which is correct for host-side `pnpm --filter
   @spectado/control-panel dev` (Docker publishes that port to the host) but wrong _inside_ the `control-panel-dev`/
   `player-dev` containers themselves — there, `localhost` is the container, not `api`. Fixed by setting
   `VITE_DEV_API_PROXY_TARGET=http://api:3000` for both dev services in `docker-compose.override.yml`, using Docker's
   embedded DNS over the `edge` network they share with `api` (rather than `host.docker.internal`, which needs extra
   config on native Linux Docker).

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
cases needed _different_ fixes: `/manage` got an explicit `location = /manage { return 301 $scheme://$http_host/manage/; }`
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
validation error (`P1012`) — the connection URL lives _only_ in `prisma.config.ts` (`packages/database/prisma.config.ts`)
now. (2) That config file's `datasource.url` is evaluated for **every** Prisma command, including `generate`, which
never needed a real connection before — reading `process.env.DATABASE_URL` directly with a placeholder fallback
(rather than the stricter `env()` helper, which throws on a missing var) is what keeps `generate` working during
`docker build` (no `DATABASE_URL` at build time) and plain `pnpm turbo run typecheck` on a bare host. (3) The
`prisma-client` generator (replacing `prisma-client-js`) outputs plain, uncompiled `.ts` files to your chosen
`output` path (e.g. `packages/database/generated/prisma/client.ts`) — no `package.json`/`exports` field, so import it
by its actual file path (with this repo's usual `.js`-suffixed relative-import convention), not as if it were an
installed package. (4) The generated client's _internals_ still import `@prisma/client` for shared runtime helpers
even though your own code no longer needs to — don't remove it from `package.json` just because nothing you wrote
imports it directly. (5) A driver adapter (`@prisma/adapter-pg` here) is mandatory — `new PrismaClient()` with no
arguments no longer works at all.

**`master.m3u8` 404s.** Check `docker compose logs encoder` — the two most likely causes are the PCM FIFO not
existing yet (created by `apps/encoder/docker/entrypoint.sh`, which only runs in the production image stage — the
dev override recreates this step inline in its `command:`) or `ffmpeg` missing from whatever stage the encoder
container is actually running (both the `builder` and `runtime` stages install it, from a shared `base` stage, for
exactly this reason).

**Rotated a password in `.env` and now `api-migrate`/`api` can't authenticate to Postgres.** Postgres (and MinIO)
only use their root password env vars to initialize a _fresh_ data volume — changing `.env` and restarting an
already-initialized container does not rotate the real stored credential, it just changes what the _other_ services
now try to connect with. Rotate it in place instead of wiping data:

```bash
docker run --rm --network <project>_data -e PGPASSWORD=<old password> postgres:16-alpine \
  psql -h postgres -U radio -d radio -c "ALTER ROLE radio WITH PASSWORD '<new password>';"
```

(Redis is the exception — `requirepass` isn't stored in its persisted data at all, so recreating that one container,
e.g. `docker compose up -d --force-recreate redis`, is enough.)

**`prisma.user... The table does not exist`.** No migration has been generated yet — see the `prisma migrate dev
--name init` step in [Getting started](#getting-started-local-development). `prisma migrate deploy` (what the
`api-migrate` service runs) only _applies_ existing migration files, it doesn't generate new ones from the schema.
