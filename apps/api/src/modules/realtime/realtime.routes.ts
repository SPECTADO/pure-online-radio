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
  const wsUrl = `${config.publicBaseUrl.replace(/^http/, "ws")}/realtime`;
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
