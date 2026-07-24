import { Router } from "express";
import { NATS_WILDCARDS, NatsCredentialsSchema, type NatsCredentialsDTO } from "@spectado/shared-types";
import { config } from "../../config/env.js";
import { requireAuth } from "../../middleware/auth.js";

export const realtimeRoutes = Router();

/**
 * v1 simplification: every authenticated manager/admin is handed the SAME
 * static, subscribe-only NATS credential (a single "control-panel" user
 * configured subscribe-only at the NATS auth layer -- see
 * infra/docker/nats/nats-server.conf, owned by another engineer). It cannot
 * publish anything and cannot be revoked per-session.
 *
 * Future upgrade: issue per-session, individually revocable NATS credentials
 * via decentralized JWT/nkeys so a single manager's session can be revoked
 * without rotating a secret shared by everyone.
 */
realtimeRoutes.get("/nats-credentials", requireAuth, (_req, res) => {
  // Trailing slash is required: nginx's `/realtime/` location is a prefix
  // match that only matches URIs literally starting with that trailing slash
  // (see apps/webserver/nginx/conf.d/default.conf) — a bare "/realtime" falls
  // through to the player SPA location instead and gets a normal 200 HTML
  // response rather than a 101 WebSocket upgrade. Unlike the equivalent
  // /manage vs /manage/ bug, this one can't be papered over with a redirect:
  // WebSocket clients don't follow HTTP redirects during the handshake, so
  // the URL has to be correct at the source.
  const wsUrl = `${config.publicBaseUrl.replace(/^http/, "ws")}/realtime/`;
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const credentials: NatsCredentialsDTO = {
    url: wsUrl,
    user: config.controlPanelNats.user,
    password: config.controlPanelNats.password,
    expiresAt,
    allowedSubjects: [NATS_WILDCARDS.encoderStatus, NATS_WILDCARDS.control],
  };

  res.json(NatsCredentialsSchema.parse(credentials));
});
