import { Router } from "express";
import { z } from "zod";
import { PlaybackModeSchema } from "@spectado/shared-types";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { notImplemented } from "../../lib/notImplemented.js";
import { publishAdvanceCommand, publishSetModeCommand } from "../../nats/publishers.js";

export const queueRoutes = Router();

queueRoutes.use(requireAuth, requireRole("MANAGER", "ADMIN"));

queueRoutes.get(
  "/",
  notImplemented("resolve the current queue: due one-off items + active clock wheel lookahead"),
);

queueRoutes.post(
  "/items",
  notImplemented("validate CreateQueueEntryRequestDTO and create a ScheduledItem row"),
);

queueRoutes.delete("/items/:id", notImplemented("cancel a pending ScheduledItem"));

queueRoutes.patch(
  "/items/reorder",
  notImplemented("reorder same-timestamp ScheduledItem.position values"),
);

// --- these publish real NATS commands + write CommandAuditLog rows, proving the
// command-publish path end-to-end even though queue resolution logic isn't built yet ---

queueRoutes.post("/skip", async (req, res, next) => {
  try {
    const command = await publishAdvanceCommand({
      requestedBy: req.user?.username ?? null,
      reason: "skip",
      userId: req.user?.id ?? null,
    });
    res.json({ ok: true, commandId: command.commandId });
  } catch (err) {
    next(err);
  }
});

queueRoutes.post("/start", async (req, res, next) => {
  try {
    const command = await publishAdvanceCommand({
      requestedBy: req.user?.username ?? null,
      reason: "manual-start",
      userId: req.user?.id ?? null,
    });
    res.json({ ok: true, commandId: command.commandId });
  } catch (err) {
    next(err);
  }
});

const SetModeRequestSchema = z.object({ mode: PlaybackModeSchema });

queueRoutes.post("/mode", async (req, res, next) => {
  const parsed = SetModeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request body", issues: parsed.error.issues });
    return;
  }

  try {
    const command = await publishSetModeCommand({
      mode: parsed.data.mode,
      userId: req.user?.id ?? null,
    });
    res.json({ ok: true, commandId: command.commandId });
  } catch (err) {
    next(err);
  }
});
