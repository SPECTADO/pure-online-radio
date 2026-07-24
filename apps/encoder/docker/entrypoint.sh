#!/bin/sh
set -e

# The master PCM FIFO lives on a private tmpfs/container path, NOT on the
# shared HLS volume - only this process and the ffmpeg it spawns ever touch
# it. Created here (once, at container start) rather than baked into the
# image so it's always a fresh named pipe with no stale fd holders.
mkdir -p /run/encoder/pcm
[ -p /run/encoder/pcm/master.fifo ] || mkfifo /run/encoder/pcm/master.fifo

# Run via tsx rather than plain `node`: @spectado/shared-types ships as raw
# TypeScript source with no build step of its own (its package.json points
# straight at ./src/index.ts, using .js-suffixed relative imports that assume
# a TS-aware resolver). Plain `node` cannot resolve those .js specifiers to
# their sibling .ts files even with its native type-stripping support - tsx
# (esbuild-based, already used for "dev") handles that resolution correctly,
# so this app's own compiled dist/index.js still runs through it in
# production. See Dockerfile for the same note.
exec ./node_modules/.bin/tsx --env-file-if-exists=../../.env dist/index.js
