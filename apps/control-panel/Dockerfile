# syntax=docker/dockerfile:1
#
# One-shot build image for @spectado/control-panel.
#
# Build context is the REPO ROOT (needed for the pnpm workspace):
#   docker build -f apps/control-panel/Dockerfile .
#
# Stages:
#   - `builder` — full workspace install (all workspace members, all deps).
#     Also used directly (via `--target builder`) by docker-compose for the
#     live-reload dev service, which bind-mounts source over this image and
#     runs `pnpm --filter @spectado/control-panel dev -- --host`.
#   - (default/last stage) — runs the production build on top of `builder`,
#     leaving the compiled SPA at /app/apps/control-panel/dist. The compose
#     service that copies this out into the shared static_assets volume does
#     NOT set `target`, so it gets this final stage automatically.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS builder
# Full monorepo context: control-panel only depends on @spectado/shared-types
# (workspace:*), but `pnpm install` resolves/links the whole workspace, so we
# copy everything and let pnpm figure out the graph.
COPY . .
RUN pnpm install --no-frozen-lockfile

FROM builder AS build
RUN pnpm --filter @spectado/control-panel build
