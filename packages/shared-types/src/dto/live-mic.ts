import { z } from "zod";

export const LiveMicSessionSchema = z.object({
  sessionId: z.string(),
  wsUrl: z.string(), // nginx-proxied path to the encoder's mic-ingest websocket
  wsToken: z.string(), // short-lived, scoped to this endpoint only — not the manager's own JWT
  expiresAt: z.string().datetime(),
});
export type LiveMicSessionDTO = z.infer<typeof LiveMicSessionSchema>;
