import { randomBytes, randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { LiveMicSessionSchema, type LiveMicSessionDTO } from "@spectado/shared-types";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { config } from "../../config/env.js";
import { publishLiveMusicVolumeCommand, publishLiveStartCommand, publishLiveStopCommand } from "../../nats/publishers.js";
import { clearLiveMicSession, getActiveLiveMicSession, setActiveLiveMicSession } from "./liveMicSessionState.js";

export const liveMicRoutes = Router();

liveMicRoutes.use(requireAuth, requireRole("MANAGER", "ADMIN"));

const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6h -- long enough for a talk show, session expires either way

liveMicRoutes.post("/session", async (req, res, next) => {
  if (getActiveLiveMicSession()) {
    res.status(409).json({ error: "a live mic session is already active" });
    return;
  }

  const sessionId = randomUUID();
  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  // Claimed before the (awaited) publish so two near-simultaneous requests can't both pass the guard.
  setActiveLiveMicSession(sessionId, expiresAt);
  try {
    await publishLiveStartCommand({ sessionId, token, expiresAt, userId: req.user?.id ?? null });

    const wsPath = `/live-mic/${sessionId}?token=${token}`;
    const session: LiveMicSessionDTO = {
      sessionId,
      wsPath,
      wsUrl: `${config.publicBaseUrl.replace(/^http/, "ws")}${wsPath}`,
      wsToken: token,
      expiresAt: expiresAt.toISOString(),
    };
    res.status(201).json(LiveMicSessionSchema.parse(session));
  } catch (err) {
    clearLiveMicSession(sessionId, "failed to start");
    next(err);
  }
});

liveMicRoutes.post("/session/:id/stop", async (req, res, next) => {
  try {
    await publishLiveStopCommand({ sessionId: req.params.id, userId: req.user?.id ?? null });
    clearLiveMicSession(req.params.id, "stopped via api");
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const SetMusicVolumeRequestSchema = z.object({ volume: z.number().min(0).max(1) });

liveMicRoutes.post("/music-volume", async (req, res, next) => {
  const parsed = SetMusicVolumeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request body", issues: parsed.error.issues });
    return;
  }

  try {
    const command = await publishLiveMusicVolumeCommand({
      volume: parsed.data.volume,
      userId: req.user?.id ?? null,
    });
    res.json({ ok: true, commandId: command.commandId });
  } catch (err) {
    next(err);
  }
});
