# syntax=docker/dockerfile:1
#
# Build context MUST be the repo root (needs the pnpm workspace so
# @spectado/shared-types resolves) - e.g. from docker-compose.yml:
#   build:
#     context: .
#     dockerfile: apps/encoder/Dockerfile
#
# Two stages:
#   1. builder - node:22-bookworm-slim, installs the (small) slice of the
#      pnpm workspace this app needs and compiles TypeScript to dist/.
#   2. runtime - also debian-slim (NOT alpine) so the base OS/libc matches
#      the builder exactly (avoids any glibc/musl node_modules ABI mismatch
#      if a native addon ever gets added), with ffmpeg installed via apt.
#      Alpine's ffmpeg package trails Debian's in codec/feature support, per
#      the architecture note this Dockerfile follows.
#
# NOTE on @spectado/shared-types: that package ships raw TypeScript source
# with no build step of its own (its package.json "main"/exports point
# straight at ./src/index.ts, whose own relative imports use .js-suffixed
# specifiers like "./dto/common.js" for a sibling file actually named
# common.ts - the standard TS NodeNext convention, correct for a build step
# that never happens here). Verified empirically: plain `node` (even 22.19,
# which does strip TS syntax by default now) does NOT remap those .js
# specifiers to the .ts files that actually exist on disk, so
# `node dist/index.js` fails with ERR_MODULE_NOT_FOUND the moment it imports
# @spectado/shared-types. tsx's resolver (esbuild-based) does implement that
# fallback correctly - the same reason "dev" already runs through
# `tsx watch`. So this app's compiled dist/index.js is executed via tsx in
# production too (see docker/entrypoint.sh) rather than plain node; tsx is a
# regular ("dependencies", not "devDependencies") dependency of this package
# for exactly that reason. If shared-types ever grows an actual build step,
# this can revert to plain `node dist/index.js`.

# Builds the `gpac` CLI from source for the Low Latency HLS pipeline
# (llHlsEncoder.ts) -- there's no Debian/Ubuntu apt package for it, and
# ffmpeg's own HLS muxer has no real partial-segment/EXT-X-PART support at
# all (verified directly against the installed ffmpeg build before reaching
# for GPAC, not just assumed). FROM the same base image as `base` below,
# rather than FROM base itself, to avoid a circular stage dependency (`base`
# copies the compiled binary from here) while still guaranteeing the same
# glibc. Only needed to build: --static-bin produces a single, fully static
# binary (confirmed via `ldd` -- "not a dynamic executable"), so nothing
# from this stage's build toolchain needs to survive into `base`/runtime,
# just the one COPY below.
FROM node:22-bookworm-slim AS gpac-builder
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential pkg-config git zlib1g-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/gpac/gpac.git /gpac_public
WORKDIR /gpac_public
RUN ./configure --static-bin && make -j"$(nproc)" && make install

FROM node:22-bookworm-slim AS base
# ffmpeg lives on this shared base (not just the final runtime stage) so the
# docker-compose.override.yml dev service — which targets "builder" directly
# for hot reload, skipping "runtime" entirely — can still actually spawn it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY --from=gpac-builder /usr/local/bin/gpac /usr/local/bin/gpac

FROM base AS builder
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /workspace

# Only copy the workspace slice apps/encoder actually depends on (root
# manifests + packages/config's tsconfig bases + shared-types + itself) -
# apps/api, apps/control-panel, apps/player, etc. are other engineers' work
# in progress and irrelevant to this build.
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/config/typescript ./packages/config/typescript
COPY packages/shared-types ./packages/shared-types
COPY apps/encoder ./apps/encoder

# No root pnpm-lock.yaml is committed yet at this stage of the monorepo; once
# one exists, prefer `pnpm install --frozen-lockfile` here for reproducible,
# cacheable installs.
RUN pnpm install --filter "@spectado/encoder..."

RUN pnpm --filter "@spectado/encoder" build

# Produce a self-contained deploy directory (real files, not the usual pnpm
# symlinks-into-a-content-store layout) so the runtime stage below can copy
# one directory and have a working node_modules with no dangling symlinks
# back into a builder-stage-only path.
RUN pnpm --filter "@spectado/encoder" deploy --prod /workspace/deploy

FROM base AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /workspace/deploy/dist ./dist
COPY --from=builder /workspace/deploy/node_modules ./node_modules
COPY --from=builder /workspace/deploy/package.json ./package.json
COPY apps/encoder/docker/entrypoint.sh /app/docker/entrypoint.sh
RUN chmod +x /app/docker/entrypoint.sh

ENTRYPOINT ["/app/docker/entrypoint.sh"]
