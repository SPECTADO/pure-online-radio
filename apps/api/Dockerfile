# syntax=docker/dockerfile:1.7
#
# Build context for this Dockerfile is the REPO ROOT (it needs the whole
# pnpm workspace), e.g.:
#   docker build -f apps/api/Dockerfile .

###############################################################################
# builder — full pnpm workspace install + prisma generate + api build.
#
# This stage is also runnable standalone: docker-compose can target
# `--target builder` on this same Dockerfile and override the command to run
# `pnpm --filter @spectado/database exec prisma migrate deploy` against
# DATABASE_URL, reusing the exact installed workspace + generated prisma
# client instead of maintaining a separate migration image.
###############################################################################
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /workspace

# Root workspace manifests first so `pnpm install` is cached independently of
# application source changes. The lockfile glob copies nothing (no error) if
# pnpm-lock.yaml doesn't exist yet.
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY pnpm-lock.yaml* ./

# Every workspace package's manifest, so pnpm can resolve the full dependency
# graph before any real source is copied in.
COPY packages/config/typescript/package.json ./packages/config/typescript/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/shared-types/package.json ./packages/shared-types/package.json
COPY apps/api/package.json ./apps/api/package.json

RUN pnpm install --frozen-lockfile=false

# Now bring in real source and build.
COPY packages ./packages
COPY apps/api ./apps/api

RUN pnpm --filter @spectado/database exec prisma generate
RUN pnpm --filter @spectado/api build

###############################################################################
# runner — slim production image: only the compiled app, its node_modules,
# and the generated prisma client are needed at runtime.
###############################################################################
FROM node:22-alpine AS runner

WORKDIR /workspace

ENV NODE_ENV=production

# Root node_modules (pnpm's central .pnpm store + hoisted bins)...
COPY --from=builder /workspace/node_modules ./node_modules
# ...and packages/*, because pnpm's workspace:* symlinks point at these
# directories (this is also where `prisma generate` wrote the client).
COPY --from=builder /workspace/packages ./packages
COPY --from=builder /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=builder /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /workspace/apps/api/dist ./apps/api/dist

WORKDIR /workspace/apps/api

EXPOSE 3000

# `tsx`, not plain `node`: @spectado/database and @spectado/shared-types are
# consumed as raw TypeScript across this whole monorepo (their tsconfigs set
# `noEmit: true` -- there's no compiled dist/ for them anywhere), using
# relative imports with explicit `.js` extensions that resolve to `.ts` files.
# That remapping is a NodeNext/tsx module-resolution convention, not something
# plain `node` understands (verified: `node dist/index.js` throws
# ERR_MODULE_NOT_FOUND resolving "@spectado/shared-types"'s own internal
# imports) -- `--experimental-strip-types` alone does NOT fix this either,
# since it only strips types from a file already found, it doesn't add the
# .js-specifier -> .ts-file remapping. `tsx` implements that remapping and
# runs compiled .js entry files just fine, so this is the pragmatic fix within
# apps/api's own scope. Revisit once @spectado/database and
# @spectado/shared-types gain their own build step producing real dist/ JS.
CMD ["node_modules/.bin/tsx", "--env-file-if-exists=../../.env", "dist/index.js"]
