# spectado-pure-online-radio

Self-hosted online radio platform (manager control panel, public player, ffmpeg-based HLS encoder, Express API,
Postgres/Redis/MinIO/NATS) orchestrated via Docker Compose. Stack: TypeScript 7, Prisma 7 (driver-adapter-based
client, no schema-level `url`, connection config lives in `packages/database/prisma.config.ts`), Vite 8 + React 19
for the two frontend apps. **Read `README.md` first** — architecture, setup,
deployment, the full NATS subject contract, and a Troubleshooting section documenting every non-obvious bug already
hit and fixed in this stack. Don't re-derive any of that from scratch; it's current and maintained. `docs/PLAN.md`
is the original architecture plan from before any code existed — useful for *why* early structural decisions were
made, but superseded by README.md wherever the two disagree.

## Current status

This was deliberately scoped to a **"scaffold only" pass, confirmed explicitly with the user** (not a shortcut taken
unilaterally): build real, end-to-end-verified infrastructure/wiring, but leave most station-management business
logic — queue resolution, library file upload, clock wheels, scheduling, jingle/mic/relay mixing in the encoder — as
stubbed routes/modules (correct interfaces, TODO comments, no logic yet). The reasoning: the full feature set is
large enough that attempting it all at once would mean either a much longer session or a shallower, less-verified
result everywhere — infra is the part hardest to retrofit later (Docker networking, NATS auth, the HLS pipeline, the
DB schema), so that got built carefully and genuinely verified (including a from-scratch `docker compose down -v` +
fresh `up` cycle), while business logic is comparatively easy to layer in incrementally.

Check README.md's "Implementation status" section for the current real-vs-stub breakdown before assuming a feature
works — that's the source of truth and will keep changing; update it (and this file, if the scope framing changes)
whenever you implement one of the stubs for real.

## Before you touch anything

- **`pnpm run dev` (repo root) is the only supported way to run `apps/api`/`apps/encoder` for development** — the
  user explicitly confirmed this (asked directly whether they wanted raw host-dev support added instead; they
  didn't). It runs `docker compose --profile dev-hmr up --build` — hot reload for every component. Do not run their
  own `dev`/`start` scripts directly on the host: `DATABASE_URL`/`REDIS_URL`/`NATS_URL` use Docker-internal
  hostnames that don't resolve outside the Compose network, and the containers already occupy the same ports.
  `apps/control-panel` and `apps/player` are fine to run raw on the host if you want (their Vite dev server just
  proxies to `localhost:3000`, which is reachable) — the constraint is specific to api/encoder's networking, not a
  blanket rule against host-side dev tooling in general.
- If you edit source in `apps/api`/`apps/encoder` while the stack is running and the change doesn't seem to apply,
  don't assume the fix is wrong first — run `docker compose restart <service>`. Docker Desktop's bind-mount file
  watching doesn't always propagate host-side edits into `tsx watch` reliably.
- After changing anything in `apps/webserver/nginx/` or `infra/docker/nats/`, rebuild the image
  (`docker compose build webserver` / `nats`) — these aren't fully bind-mounted, so a plain restart can silently run
  stale config.
- Rotating a secret in `.env` does **not** retroactively update an already-initialized Postgres/MinIO container —
  see the README's "Rotated a password..." troubleshooting entry before assuming a fresh `.env` value is live
  everywhere.
- After bumping a dependency and rebuilding an image, if `api`/`encoder` still can't resolve the new package inside
  the dev container, the anonymous `node_modules` volumes in `docker-compose.override.yml` are almost certainly
  stale (they survive plain rebuilds/restarts) — `docker compose up -d --force-recreate --renew-anon-volumes
  api encoder` before assuming the dependency itself is broken. Hit this for real during the TS7/Prisma7/Vite8/
  React19 upgrade.

## Where things live

- `docs/PLAN.md` — the original pre-code architecture plan (historical, see note at top of this file).
- `packages/shared-types` — the wire contract (DTOs + NATS subjects/Zod schemas) shared by api/control-panel/encoder.
  Change here first when adding an endpoint or message shape; don't redefine types locally in an app.
- `packages/database/prisma/schema.prisma` — the full data model; migrations are real and committed under
  `prisma/migrations/` (not just a schema file waiting to be migrated).
- `apps/webserver/nginx/conf.d/default.conf` — the only public HTTP surface. Has several deliberately non-obvious
  patterns (lazy DNS resolution via `resolver` + variables, `rewrite ... break` ordering, path-scoped asset caching)
  — read the comments in-file and the matching README Troubleshooting entries before changing it.
