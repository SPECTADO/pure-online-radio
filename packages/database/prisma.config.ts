import { defineConfig } from "prisma/config";

// No `dotenv/config` import here (unlike Prisma's own example configs) — this
// project never relies on Prisma auto-loading a .env file: docker-compose
// injects DATABASE_URL as a real process env var directly, and every
// host-side CLI invocation in the README prefixes it explicitly
// (`DATABASE_URL=... pnpm --filter @spectado/database exec prisma ...`). If
// that ever changes, add `import "dotenv/config";` as the first line.
//
// Reading `process.env.DATABASE_URL` directly (with a fallback) instead of
// the `env()` helper is deliberate, not a shortcut: `env()` throws immediately
// if the var is unset, and this config file is evaluated for EVERY prisma
// command including `generate` — which doesn't need a real connection at all
// (it just needs the schema). `generate` runs in contexts with no
// DATABASE_URL available: `pnpm turbo run typecheck`/`build` on a bare host,
// and the Docker builder stage (DATABASE_URL is only injected at container
// *runtime* by docker-compose, not at `docker build` time). `migrate`/`studio`
// commands, which genuinely need a working connection, are only ever invoked
// in this project with a real DATABASE_URL already set — see README/CLAUDE.md.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
