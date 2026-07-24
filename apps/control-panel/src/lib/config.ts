/**
 * Runtime configuration. In production, nginx's container entrypoint writes
 * `/env-config.js` (loaded by index.html before this bundle) which sets
 * `window.__APP_CONFIG__` before any app code runs. During plain `vite dev`
 * (no docker, no env-config.js) that global is absent — fall back to
 * same-origin dev defaults so the app never hard-crashes on a missing file.
 */

export interface AppConfig {
  /** Base URL for API calls. Same-origin relative path works both behind
   * nginx (`/api/*` proxied) and in `vite dev` (proxied via server.proxy). */
  apiBaseUrl: string;
  /** Base URL the NATS-ws client should use if the API doesn't hand back an
   * absolute one. Derived from window.location so it works from any host. */
  realtimeBaseUrl: string;
}

declare global {
  interface Window {
    __APP_CONFIG__?: Partial<AppConfig>;
  }
}

function devDefaults(): AppConfig {
  const { protocol, host } = window.location;
  const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
  return {
    apiBaseUrl: "/api",
    realtimeBaseUrl: `${wsProtocol}//${host}/realtime`,
  };
}

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const fromWindow = typeof window !== "undefined" ? window.__APP_CONFIG__ : undefined;
  const fallback = devDefaults();
  cached = {
    apiBaseUrl: fromWindow?.apiBaseUrl ?? fallback.apiBaseUrl,
    realtimeBaseUrl: fromWindow?.realtimeBaseUrl ?? fallback.realtimeBaseUrl,
  };
  return cached;
}
