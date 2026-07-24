import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { notImplemented } from "../../lib/notImplemented.js";

export const liveMicRoutes = Router();

liveMicRoutes.use(requireAuth, requireRole("MANAGER", "ADMIN"));

liveMicRoutes.post(
  "/session",
  // TODO: issue a scoped, short-lived wsToken (NOT the manager's own JWT) tied to
  // this endpoint only, persist a LiveMicSessionDTO-shaped session, then publish
  // radio.encoder.cmd.live.start (LiveStartCommandSchema) with that token so the
  // encoder can authorize the mic-ingest websocket.
  notImplemented("issue scoped live-mic session token + publish radio.encoder.cmd.live.start"),
);

liveMicRoutes.post(
  "/session/:id/stop",
  // TODO: publish radio.encoder.cmd.live.stop (LiveStopCommandSchema) for this sessionId.
  notImplemented("publish radio.encoder.cmd.live.stop for the given session"),
);
