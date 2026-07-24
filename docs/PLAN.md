> **Historical document.** This is the original architecture plan agreed on before any code was written — kept for
> the reasoning behind early decisions (why two Docker networks, why the encoder never touches MinIO directly, why
> NATS subjects are namespaced the way they are, etc.). It reflects the state of understanding *at planning time*,
> not the current state of the repo — for that, see `README.md` (architecture/setup/status) and `CLAUDE.md`
> (must-know rules for working in this repo). One specific assumption below has since been proven wrong during
> implementation and is called out inline where it appears.

# Spectado Pure Online Radio — Monorepo Provisioning Plan

## Context

The user wants to provision a brand-new monorepo for a self-hosted online radio station: a manager control panel, a public player, an internal API, a Postgres/Prisma data layer, MinIO object storage, NATS realtime bus, Redis cache, and an ffmpeg-based HLS encoder — all orchestrated via Docker Compose. The repo directory is currently empty. Three parallel design passes (infra/DB, encoder pipeline, API/control-panel/player) produced detailed designs; this plan reconciles a few naming/path inconsistencies between them into one canonical architecture and scopes the actual build.

**Scope for this pass (confirmed with user): scaffold only.** Goal is `docker compose up` bringing up every service successfully, with real infra wiring (DB migrated, NATS connected, MinIO bucket created, nginx serving/proxying everything, HLS output actually playable — even if just a silence/test-tone stream) and real auth, but with most business logic (queue resolution, clock wheels, library CRUD, jingle/mic/relay mixing) left as clearly-marked TODO stubs for follow-up passes.

---

## Reconciliation notes (fixes applied across the three sub-designs)

1. **NATS subject namespace** — unified to three namespaces instead of three slightly different proposals:
   - `radio.encoder.cmd.*` — API → encoder commands.
   - `radio.encoder.status.*` — encoder → API/control-panel telemetry (now-playing, queue advanced, jingle/live/relay start-stop, errors, heartbeat, command acks).
   - `radio.control.*` — API-originated broadcasts to control-panel browsers that don't originate from the encoder (mode-change confirmation for cross-tab sync, queue-updated signal, library-empty alert).
   NATS user permissions: `api` publishes `radio.encoder.cmd.>` + `radio.control.>`, subscribes `radio.encoder.status.>`. `encoder` publishes `radio.encoder.status.>`, subscribes `radio.encoder.cmd.>`. `control-panel` (browser, static shared credential for v1) subscribes `radio.encoder.status.>` + `radio.control.>` only, publish denied entirely.
2. **Internal callback endpoint** — canonicalized as `GET /internal/playback/next`, returning a discriminated `PlaybackDirectiveDTO` (`track | external_relay | silence`), not a bare queue row — matches what the encoder actually needs.
3. **HLS/FIFO paths** — shared `hls_output` volume mounted at `/data/hls` in `encoder` (read-write) and `/var/www/hls` in `webserver` (read-only). Encoder writes `master.m3u8`, `low/playlist.m3u8`+segments, `high/playlist.m3u8`+segments directly under `/data/hls`. The PCM FIFO (`/run/encoder/pcm/master.fifo`) is **not** on the shared volume — it's encoder-internal only.
4. **Encoder never touches MinIO directly** — no MinIO credentials or S3 client in the encoder. The API resolves presigned GET URLs (TTL 30–60min) and includes them directly in the `/internal/playback/next` response; encoder just passes that URL string to ffmpeg's `-i`. (Drops the `s3Client.ts` module from the encoder's original file list.)
5. **JWT delivery** — httpOnly, Secure, SameSite=Strict cookies (access + refresh), not a token returned to JS/localStorage — avoids exposing the JWT to XSS given the app renders manager-supplied strings (song/jingle titles). *(Since refined further: `Secure` is now conditional on `NODE_ENV === "production"` — see README Troubleshooting, "Login succeeds but every subsequent request 401s".)*

---

## Monorepo layout

```
spectado-pure-online-radio/
├── apps/
│   ├── api/                  # Express + TS — internal only, behind nginx
│   ├── control-panel/        # React + Vite + Tailwind — manager UI
│   ├── player/                # React + Vite + Tailwind — public player
│   ├── encoder/               # Node + ffmpeg orchestrator
│   └── webserver/             # nginx gateway (no package.json)
├── packages/
│   ├── shared-types/          # DTOs, enums, NATS subjects + zod payload schemas
│   ├── database/              # Prisma schema/migrations + client singleton + seed script
│   └── config/typescript/     # shared tsconfig bases
├── infra/docker/
│   └── nats/nats-server.conf
├── docker-compose.yml
├── docker-compose.override.yml   # dev: bind mounts, hot reload, host ports for DB/MinIO/etc
├── docker-compose.prod.yml       # prod: pre-built images, no bind mounts
├── .env.example
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

Tooling: pnpm workspaces + Turborepo (`tasks` key, `catalog:` for shared dep versions). Each app depends on `@spectado/shared-types` and (api/encoder only) `@spectado/database` via `workspace:*`.

---

## Docker Compose & networking

Two bridge networks: `data` (postgres, redis, minio, minio-init, nats) and `edge` (webserver). `api` and `encoder` join **both** — they're the only services allowed to bridge. Only `webserver` publishes a host port (`80:80`). No `internal: true` flag (would block encoder's outbound internet access needed for external-stream relay URLs) — "not publicly exposed" is enforced simply by never mapping a host port for those services.

*(Since refined: `nats` also joins `edge` — nginx proxies `/realtime` directly to it, which the two-network split above didn't originally account for. See README's "Architecture" section for the current, accurate network topology.)*

Services: `postgres:16-alpine`, `redis:7.2-alpine` (flag Redis's RSAL/SSPL relicense to the user — `valkey/valkey` is a drop-in swap if it matters), `minio` + a one-shot `minio-init` sidecar (mc client, creates the bucket, sets private ACL), `nats:2.11-alpine` (websocket listener on 9222, auth config from `infra/docker/nats/nats-server.conf`), `api-migrate` (one-shot `prisma migrate deploy`), `api`, `encoder` (image built from `apps/encoder`, envs for NATS/API-callback/HLS output dir), `control-panel-build`/`player-build` (one-shot Vite builds writing into a shared `static_assets` volume), `webserver` (nginx, mounts `static_assets` + `hls_output` read-only, the only published port).

Env strategy: root `.env` (gitignored) + `.env.example` (committed) for compose interpolation. Vite apps get runtime config via an `env-config.js` generated by nginx's entrypoint (`envsubst`) at container start — avoids baking `VITE_*` vars into the image at build time, so one image works across dev/staging/prod.

Dev vs prod: `docker-compose.override.yml` auto-merges for `docker compose up` (bind-mounted source, `vite dev --host`, DB/MinIO/NATS ports published to host for local tooling); `docker-compose.prod.yml` used explicitly via `-f` (pre-built tagged images, `restart: unless-stopped`, no dev ports).

---

## Database schema (Prisma, PostgreSQL)

Full model set in `packages/database/prisma/schema.prisma`: `User` (role enum MANAGER/ADMIN), `Category`, `Song`, `Jingle` (distinct media type, own `JingleType` enum), `ScheduledItem` (one-off song/jingle scheduling, `scheduledFor` + status), `ClockWheel` + `ClockWheelSlot` (weekday array + start/end time) + `ClockWheelStep` (ordered pick rules: category/tag + `SelectionStrategy` RANDOM/LEAST_OFTEN_PLAYED), `SeparationRule` (global singleton for v1: artist-separation-minutes, song-separation-minutes; scoped-to-clock-wheel columns present but unused), `ExternalStream` (url, startAt, endAt, status), `PlaybackHistoryEntry` (append-only log with denormalized `titleSnapshot`/`artistSnapshot` — this is what both separation-rule checks and "now playing" reconstruction read from), `CommandAuditLog` (every NATS command the API publishes, for audit).

Multi-station future-proofing: every content table gets a nullable `stationId` scaffold column now; no `Station` model yet. Adding multi-station later means adding the table + backfilling + tightening the column — no restructuring of anything else.

Seed script (`packages/database/prisma/seed.ts`): one admin `User` (bcrypt/argon2-hashed password from env), one default `Category` ("ALL") — enough to exercise login and the library UI shell.

---

## NATS contract (`packages/shared-types/src/nats/`)

`subjects.ts` exports the subject-name constants for all three namespaces from the reconciliation notes above; `messages.ts` exports a Zod schema per subject (`AdvanceCommand`, `SetModeCommand`, `JinglePlayCommand`, `LiveStartCommand`, `RelayStartCommand`, `NowPlayingStatus`, `QueueAdvancedStatus`, `ErrorStatus`, `HeartbeatStatus`, `ModeControlBroadcast`, `AlertBroadcast`, etc.) so the API publisher, the encoder, and the control-panel's browser subscriber all validate the same shape. This package has zero dependency on Prisma/Express, so it stays safe to hand to another codebase if the encoder is ever developed separately.

`infra/docker/nats/nats-server.conf`: three users (`api`, `encoder`, `control-panel`) with the permissions from reconciliation note #1, passwords substituted from container env at startup (`nats-server` supports `$VAR` tokens natively — no secrets baked into the conf file).

> **This assumption turned out to be wrong.** `nats-server`'s own `$VAR` substitution is unreliable for arbitrary
> secrets: a quoted `"$VAR"` reference silently doesn't substitute at all, and an unquoted one substitutes raw text
> that then breaks the moment a generated password happens to start with a digit (its parser tries to read it as a
> number). The actual, working approach: `infra/docker/nats/nats-server.conf.template` + a custom entrypoint that
> pre-resolves `${VAR}` placeholders via `envsubst` into a fully-quoted config *before* `nats-server` ever reads it —
> see README's Troubleshooting entry on this exact error for the full story.

---

## API server skeleton (`apps/api`)

Structure: `middleware/` (`auth.ts` JWT-cookie verify, `internalOnly.ts` shared-secret guard for `/internal/*`, `upload.ts`, `errorHandler.ts`, `rateLimit.ts`), `modules/{auth,library,queue,schedule,clockWheels,settings,externalStreams,liveMic,realtime,internal,public,nowPlaying}/`, `nats/{client,publishers}.ts`, `redis/client.ts`.

**Real for this pass:** `POST /auth/login` (Prisma `User` lookup + bcrypt/argon2 + httpOnly JWT cookie), `POST /auth/refresh`, `GET /auth/me`, `GET /realtime/nats-credentials` (returns the static `control-panel` NATS user/password + the nginx-proxied `wss://.../realtime` URL — noted as a v1 simplification, upgrade path to per-session NATS decentralized JWT/nkeys later), NATS client connects and can publish/subscribe, Redis client connects, Prisma client connects, `GET /healthz` (checks DB/Redis/NATS reachability), `GET /public/now-playing` (reads Redis cache, falls back to a static "Off Air" placeholder if empty).

**Stubbed (route registered, returns 501 or fixture JSON, business logic is a TODO):** `library/*` CRUD, `queue/*`, `schedule/*`, `clock-wheels/*`, `settings/separation-rules`, `external-streams/*`, `live-mic/*`, `internal/playback/next` (returns a hardcoded `silence` directive for now — enough for the encoder skeleton to call it and get a well-formed response).

---

## Control panel skeleton (`apps/control-panel`)

Vite + React + Tailwind, `react-router-dom` routes matching the page list from the design pass (`/login`, `/`, `/library/songs`, `/library/jingles`, `/queue`, `/schedule`, `/clock-wheels`, `/clock-wheels/:id`, `/external-streams`, `/settings/separation-rules`). `AppShell`/`NavSidebar`/`TopBar` layout with a `ConnectionStatusBadge`. `ProtectedRoute` wired to the **real** login flow (calls the API's real `/auth/login`, hydrates from `/auth/me`). Connects to NATS over websocket via the real `/realtime/nats-credentials` endpoint and shows live connection status. All feature pages beyond login render a simple "Coming soon" placeholder — no CRUD forms/tables built yet. `@tanstack/react-query` + `zustand` wired as the state layer per the design, even though most queries return stub data for now.

---

## Player skeleton (`apps/player`)

Vite + React + Tailwind, single page (`AlbumArt`, `TrackInfo`, `PlayerControls`, `AudioElement`). `hls.js` wired to the real nginx-served `/master.m3u8` (real, because the encoder skeleton actually produces a test-tone/silence stream — see below). Polls `GET /api/public/now-playing` every 5s via React Query (`refetchIntervalInBackground:false`, pause on `visibilitychange`) — returns the API's placeholder "Off Air" data for now, but the polling/rendering path is fully real and ready for real data later.

---

## Encoder skeleton (`apps/encoder`) — minimal but real pipeline

Full module layout per the design (`core/{mixer,ringBuffer,pcmFraming,fifoWriter}`, `sources/{queueSource,fillerSource,relaySource,jingleSource,micSource,transitionSource}`, `process/{ffmpegProcess,processSupervisor,masterEncoder}`, `controllers/{queueController,jingleController,liveMicController,relayController}`, `api/apiClient.ts`, `nats/{natsClient,subjects,commandRouter,statusPublisher}`, `ws/liveMicServer.ts`, `health/healthMonitor.ts`) — files created with real interfaces/types, but most controllers are stubs that log "not implemented" for jingle/mic/relay/queue-resolution.

**What's actually wired end-to-end for verification:** `docker/entrypoint.sh` creates the FIFO at `/run/encoder/pcm/master.fifo`; a minimal `FillerSource` writes a continuous 440Hz sine tone (or silence) as f32le/48000/stereo frames into the FIFO on a drift-corrected 20ms tick (no mixing of other sources yet — just proves the bus/FIFO/timing mechanism works); `MasterEncoder` spawns the real multi-bitrate ffmpeg HLS command from the design (`asplit` into 64k/256k AAC variants, `-var_stream_map`, writing to `/data/hls`); `ProcessSupervisor` restarts it on crash. `apiClient.ts` calls the real `GET /internal/playback/next` on a timer and logs the (stubbed) response, proving the encoder↔API HTTP path. `natsClient.ts` connects, subscribes to `radio.encoder.cmd.>`, and logs received commands without acting on most of them yet.

Result: `docker compose up` produces an actual playable HLS stream (a test tone) at `http://localhost/master.m3u8`, provable in the player app, before any real queue/library logic exists.

---

## nginx (`apps/webserver`)

Single `server` block: `/` → player SPA (`static_assets/player`), `/manage/` → control-panel SPA (`static_assets/control-panel`, path-based to avoid CORS/extra-TLS-cert setup for v1), `/api/` → proxy to `api:3000`, `*.m3u8`/`*.ts` → served from `/var/www/hls` with correct `Cache-Control`/CORS/mime-type headers, `/realtime/` → proxy to `nats:9222` (websocket upgrade headers, long `proxy_read/send_timeout`), `/live-mic/` → proxy to `encoder:8080` (same websocket-upgrade treatment, for later use). TLS termination deliberately left to whatever sits in front (cloud LB / Caddy / Certbot sidecar) — out of scope for this pass.

*(Since refined significantly: lazy DNS resolution via `resolver` + variables, `rewrite ... break` ordering, path-scoped asset-cache locations, and explicit `/manage` → `/manage/` redirect handling. See README's Architecture and Troubleshooting sections — the nginx config accumulated several genuinely subtle fixes this plan doesn't anticipate.)*

---

## Scaffold steps (order of execution)

1. `git init`, pnpm/corepack setup, root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.env.example`.
2. `packages/config/typescript`, `packages/shared-types` (DTOs + NATS subjects/schemas), `packages/database` (`prisma init`, write `schema.prisma`, first migration, seed script).
3. `apps/api` skeleton (Express app, middleware, module route files, NATS/Redis/Prisma clients, real auth + healthz + public now-playing, stubbed everything else).
4. `apps/encoder` skeleton (module layout, entrypoint + FIFO, filler tone source, master HLS ffmpeg process, supervisor, NATS command subscriber, API poll client).
5. `apps/control-panel` and `apps/player` (Vite scaffolds, Tailwind, routing/layout, real auth + NATS-ws + HLS.js/polling wiring, placeholder feature pages).
6. `apps/webserver` (Dockerfile, nginx.conf, conf.d/default.conf, entrypoint for env-config.js).
7. `infra/docker/nats/nats-server.conf`, root `docker-compose.yml` + `docker-compose.override.yml`.
8. Bring the stack up, verify (below), fix any wiring issues.

---

## Verification plan

1. `docker compose up --build` — all services reach healthy/running state (`postgres`, `redis`, `minio`, `nats`, `api-migrate` completes, `api`, `encoder`, `control-panel-build`/`player-build` complete, `webserver`).
2. `curl http://localhost/api/healthz` — confirms API ↔ Postgres/Redis/NATS connectivity.
3. Open `http://localhost/master.m3u8` in a browser/`ffprobe` — confirms the encoder's test-tone HLS stream is being produced and served correctly (multi-bitrate playlists resolve, segments download).
4. Open `http://localhost/` (player) — confirms it plays the test-tone stream via hls.js and shows the "Off Air" placeholder now-playing info, polling without errors.
5. Open `http://localhost/manage/` (control panel) — log in with the seeded admin user, confirm the `ConnectionStatusBadge` shows NATS-ws connected, confirm placeholder pages render.
6. Publish a manual test message to `radio.encoder.cmd.advance` (e.g. via `nats` CLI against the exposed dev port) and confirm the encoder's log shows it received the command via `commandRouter`.

*(All of the above has since actually been performed, repeatedly, including a from-scratch `docker compose down -v` + fresh `up` cycle — see README's "Implementation status" for current real-vs-stub state.)*
