import { z } from "zod";

export const LiveMicSessionSchema = z.object({
  sessionId: z.string(),
  // Origin-relative path (incl. `?token=`) of the encoder's mic-ingest websocket, proxied by Caddy
  // (apps/webserver/Caddyfile `/live-mic/*`) and by the control panel's Vite dev server. The browser
  // turns it into a ws(s):// URL against its *own* page origin -- the only origin guaranteed to be
  // reachable from wherever the panel is actually open (LAN IP, domain, https -> wss, :5173 dev).
  wsPath: z.string(),
  // Same endpoint as an absolute URL built from the api's PUBLIC_BASE_URL. Kept for backward
  // compatibility only -- wrong whenever the panel isn't opened at exactly PUBLIC_BASE_URL; prefer wsPath.
  wsUrl: z.string(),
  wsToken: z.string(), // short-lived, scoped to this endpoint only — not the manager's own JWT
  expiresAt: z.string().datetime(),
});
export type LiveMicSessionDTO = z.infer<typeof LiveMicSessionSchema>;
