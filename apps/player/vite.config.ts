import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Local dev target for the API. Override by exporting VITE_DEV_API_PROXY_TARGET
// before running `pnpm dev` if the API is running somewhere other than :3000.
const devApiProxyTarget = process.env.VITE_DEV_API_PROXY_TARGET ?? "http://localhost:3000";

// The HLS output (master.m3u8 + high/low variant playlists and segments) is
// written by the encoder but only ever served by the webserver container's
// nginx (see apps/webserver/nginx/conf.d/default.conf) -- there's no app
// behind it to proxy to directly. Without this, hitting the player through
// this dev server 404s straight through Vite's SPA history fallback instead
// (index.html, 200 text/html), which hls.js then fails to parse as a
// playlist -- manifestParsingError, stream never starts. Override via
// VITE_DEV_HLS_PROXY_TARGET if WEBSERVER_HOST_PORT isn't the default 8000.
const devHlsProxyTarget = process.env.VITE_DEV_HLS_PROXY_TARGET ?? "http://localhost:8000";

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  server: {
    // Fixed at 5174 (not Vite's 5173 default) to match the port docker-compose
    // maps for the player-dev service (5174:5174) — the compose `command` only
    // passes `--host`, not `--port`, so this has to live in config.
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": {
        target: devApiProxyTarget,
        changeOrigin: true,
        // The api app itself mounts routes at the bare path (/public, etc,
        // no /api prefix) -- nginx strips the /api prefix in production
        // (see apps/webserver/nginx/conf.d/default.conf), so the dev proxy
        // needs to do the same or every /api/* call 404s against the api.
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "^/(master\\.m3u8$|high/|low/)": {
        target: devHlsProxyTarget,
        changeOrigin: true,
      },
    },
  },
});
