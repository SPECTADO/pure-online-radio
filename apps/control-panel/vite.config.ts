import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Local dev target for the API. Override by exporting VITE_DEV_API_PROXY_TARGET
// before running `pnpm dev` if the API is running somewhere other than :3000.
const devApiProxyTarget = process.env.VITE_DEV_API_PROXY_TARGET ?? "http://localhost:3000";

export default defineConfig({
  base: "/manage/",
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: devApiProxyTarget,
        changeOrigin: true,
        // The api app itself mounts routes at the bare path (/auth, /queue,
        // etc, no /api prefix) -- nginx strips the /api prefix in production
        // (see apps/webserver/nginx/conf.d/default.conf), so the dev proxy
        // needs to do the same or every /api/* call 404s against the api.
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/realtime": {
        target: devApiProxyTarget,
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
