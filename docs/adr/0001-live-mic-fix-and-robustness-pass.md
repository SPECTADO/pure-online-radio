# ADR-0001: Live-mic fix and robustness-pass trade-offs

- **Date:** 2026-10-31
- **Status:** Accepted (pending owner review)
- **Deciders:** Claude (agent, ultracode review/fix workflow), requested by Ladislav Soukup ("check it, fix it")

## Context

Live mic from the control panel to the stream was reported broken. An end-to-end repro (headless Chrome
with a fake mic, HLS output analysed with ffmpeg) plus a three-area code review found several faults. Fixing
them meant making some trade-offs the owner never explicitly chose. They are recorded here so they can be
revisited.

## Decisions

1. **Live-mic jitter buffer of ≥1 s (adaptive up to 3 s, backlog trimmed above 5 s)** in
   `apps/encoder/src/sources/micSource.ts`. The extra mic latency is inaudible behind HLS's multi-second
   delay, whereas gaps are audible. 400 ms still under-ran on a real Chrome capture.
2. **Browser voice processing disabled** (`echoCancellation`/`noiseSuppression`/`autoGainControl: false`)
   for the broadcast mic. Noise suppression erased a steady signal within about 1 s, and AGC pumps against
   the ducked music. Level control is the mic-volume slider's job. Consequence: a manager without
   headphones may feed station audio back into the mic.
3. **The live-mic WebSocket URL is built client-side** from `window.location` plus the DTO's new relative
   `wsPath`. `wsUrl` (built from `PUBLIC_BASE_URL`) is still returned for compatibility. The api's
   one-broadcast guard now follows the encoder (`live.ended` status, heartbeat backstop), not only the
   explicit stop route.
4. **Access and refresh JWTs carry a token-type claim.** Tokens issued before this change are rejected, so
   everyone logs in once more.
5. **WEEKLY/INTERVAL triggers fire only within 5 minutes of their scheduled time** (ONE_TIME is unchanged).
   This stops a just-created rule from firing immediately for an occurrence that has already passed today.
   Consequence: an occurrence missed by more than 5 minutes (e.g. during an api outage) is skipped, not
   caught up.
6. **Storage keys for new uploads get a random suffix.** Replacing a song's audio no longer overwrites, and
   then rolls back by deleting, the live object.
7. **`/api/internal*` is blocked at Caddy (404).** The encoder reaches the api directly on the Docker
   network. The NATS `api`/`encoder` users can no longer connect over the public websocket listener.
8. **Times stay UTC, now labelled "UTC" in the UI.** A real station-timezone setting is deferred: it is a
   product decision.
9. **Deferred (not done):** persisting the MANUAL/LIVE playback mode across encoder restarts (needs a
   migration and an internal endpoint), and an idempotency key for `/internal/playback/next` claims (the
   timeout was raised to 15 s instead).

## Consequences

See README.md "Implementation status" and the Troubleshooting entries added in the same change. Revisit
decision 5 if catch-up after outages matters more than strict timing, and decision 8 when a station
timezone is introduced.
