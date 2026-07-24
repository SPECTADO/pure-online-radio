/**
 * Runtime configuration. In production, nginx's container entrypoint writes
 * `/env-config.js` (loaded by index.html before this bundle) which sets
 * `window.__APP_CONFIG__` before any app code runs. During plain `vite dev`
 * (no docker, no env-config.js) that global is absent — fall back to a
 * same-origin dev default so the app never hard-crashes on a missing file.
 */

export interface AppConfig {
  /** Base URL for API calls. Same-origin relative path works both behind
   * nginx (`/api/*` proxied) and in `vite dev` (proxied via server.proxy). */
  apiBaseUrl: string;
}

declare global {
  interface Window {
    __APP_CONFIG__?: Partial<AppConfig>;
  }
}

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const fromWindow = typeof window !== "undefined" ? window.__APP_CONFIG__ : undefined;
  cached = {
    apiBaseUrl: fromWindow?.apiBaseUrl ?? "/api",
  };
  return cached;
}
