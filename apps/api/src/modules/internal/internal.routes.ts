import { randomUUID } from "node:crypto";
import { Router } from "express";
import { PlaybackDirectiveSchema, type SilenceDirectiveDTO } from "@spectado/shared-types";
import { internalOnly } from "../../middleware/internalOnly.js";

export const internalRoutes = Router();

internalRoutes.use(internalOnly);

/**
 * TODO (future pass) -- real "what should play now" resolution algorithm:
 *   1. Any due one-off ScheduledItem (status=PENDING, scheduledFor <= now), earliest first.
 *   2. Otherwise, the active ClockWheel's next step for the current slot (weekday + time
 *      range), picking media per step.selectionStrategy (RANDOM / LEAST_OFTEN_PLAYED).
 *   3. Filter candidates against the GLOBAL SeparationRule (artist/song separation minutes)
 *      by looking at recent PlaybackHistoryEntry rows.
 *   4. Fall back to a SilenceDirective if nothing qualifies (empty queue/library, or every
 *      candidate is separation-blocked).
 *
 * For this scaffold pass we always return the fallback silence directive so the encoder
 * has a well-formed, real contract to integrate against today.
 */
internalRoutes.get("/playback/next", (_req, res) => {
  const directive: SilenceDirectiveDTO = {
    type: "silence",
    requestId: randomUUID(),
    reason: "queue-empty",
    retryAfterMs: 5000,
  };
  res.json(PlaybackDirectiveSchema.parse(directive));
});
