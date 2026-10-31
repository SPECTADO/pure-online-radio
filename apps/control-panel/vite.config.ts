import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Local dev target for the API. Override by exporting VITE_DEV_API_PROXY_TARGET
// before running `pnpm dev` if the API is running somewhere other than :3000.
const devApiProxyTarget = process.env.VITE_DEV_API_PROXY_TARGET ?? "http://localhost:3000";
// The encoder's live-mic ingest websocket (published on :8080 by docker-compose.override.yml).
// The browser derives the socket URL from its own page origin (see liveMicBroadcast.ts's
// liveMicSocketUrl), so on this dev server it connects to :5173/live-mic/... -- without this
// proxy that request has nowhere to go.
const devLiveMicProxyTarget = process.env.VITE_DEV_LIVE_MIC_PROXY_TARGET ?? "http://localhost:8080";

export default defineConfig({
  base: "/manage/",
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: devApiProxyTarget,
        changeOrigin: true,
        // The api app itself mounts routes at the bare path (/auth, /queue,
        // etc, no /api prefix) -- Caddy strips the /api prefix in production
        // (see apps/webserver/Caddyfile), so the dev proxy
        // needs to do the same or every /api/* call 404s against the api.
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/realtime": {
        target: devApiProxyTarget,
        ws: true,
        changeOrigin: true,
      },
      // Mirrors Caddy's `handle /live-mic/*` + `uri strip_prefix /live-mic`.
      "/live-mic": {
        target: devLiveMicProxyTarget,
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/live-mic/, ""),
      },
    },
  },
});
