/** Random client-side id (React list keys, toast/upload ids). Not `crypto.randomUUID()` directly:
 * browsers only expose that in a secure context (HTTPS or localhost), and plain-HTTP LAN access
 * (`http://<lan-ip>/manage/`, SITE_ADDRESS unset) is a supported deploy -- there every call would
 * throw. `crypto.getRandomValues` is available everywhere. */
export function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}
