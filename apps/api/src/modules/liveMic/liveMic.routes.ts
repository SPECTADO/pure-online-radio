import { randomBytes, randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { LiveMicSessionSchema, type LiveMicSessionDTO } from "@spectado/shared-types";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { config } from "../../config/env.js";
import { publishLiveMusicVolumeCommand, publishLiveStartCommand, publishLiveStopCommand } from "../../nats/publishers.js";

export const liveMicRoutes = Router();

liveMicRoutes.use(requireAuth, requireRole("MANAGER", "ADMIN"));

const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6h -- long enough for a talk show, session expires either way

/**
 * In-process only -- a single guard against two concurrent broadcasts, and the sessionId this
 * api instance last handed out. Safe as plain memory: docker-compose.yml runs one `api`
 * instance (no replicas configured), the same assumption modules/realtime/realtime.routes.ts's
 * NATS-ws credential broker already makes. The encoder (not the api) is the actual authority on
 * whether a session's websocket is authorized -- see LiveMicServer/LiveMicController.
 */
let activeSession: { sessionId: string; expiresAt: Date } | null = null;

liveMicRoutes.post("/session", async (req, res, next) => {
  if (activeSession && activeSession.expiresAt > new Date()) {
    res.status(409).json({ error: "a live mic session is already active" });
    return;
  }

  const sessionId = randomUUID();
  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  try {
    await publishLiveStartCommand({ sessionId, token, expiresAt, userId: req.user?.id ?? null });
    activeSession = { sessionId, expiresAt };

    const session: LiveMicSessionDTO = {
      sessionId,
      wsUrl: `${config.publicBaseUrl.replace(/^http/, "ws")}/live-mic/${sessionId}?token=${token}`,
      wsToken: token,
      expiresAt: expiresAt.toISOString(),
    };
    res.status(201).json(LiveMicSessionSchema.parse(session));
  } catch (err) {
    next(err);
  }
});

liveMicRoutes.post("/session/:id/stop", async (req, res, next) => {
  try {
    await publishLiveStopCommand({ sessionId: req.params.id, userId: req.user?.id ?? null });
    if (activeSession?.sessionId === req.params.id) {
      activeSession = null;
    }
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
