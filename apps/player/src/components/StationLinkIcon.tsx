import type { StationLinkPlatform } from "@spectado/shared-types";

/** Simple, hand-drawn monochrome glyphs (not brand marks) -- kept minimal
 * deliberately so this doesn't depend on an icon library or copyrighted assets. */
export function StationLinkIcon({ platform }: { platform: StationLinkPlatform }) {
  switch (platform) {
    case "FACEBOOK":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true">
          <path d="M13.5 21v-7.2h2.4l.36-2.8h-2.76V9.1c0-.81.22-1.36 1.39-1.36h1.48V5.2A19.8 19.8 0 0 0 14.2 5c-2.1 0-3.54 1.28-3.54 3.64V11H8.25v2.8h2.41V21z" />
        </svg>
      );
    case "INSTAGRAM":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5" aria-hidden="true">
          <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.2" cy="6.8" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case "TWITTER":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true">
          <path d="M4 4l7.2 9.4L4.4 20h2.3l5.9-5.9 4.4 5.9H21l-7.5-9.9L19.9 4h-2.3l-5.4 5.4L8.1 4z" />
        </svg>
      );
    case "YOUTUBE":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true">
          <rect x="2.5" y="5.5" width="19" height="13" rx="3.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M10.3 9v6l5-3z" />
        </svg>
      );
    case "TIKTOK":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true">
          <path d="M14.5 3.5c.4 2 1.9 3.4 4 3.6v2.6a6.6 6.6 0 0 1-4-1.3v6.4a5.3 5.3 0 1 1-4.6-5.25v2.7a2.6 2.6 0 1 0 1.9 2.5V3.5z" />
        </svg>
      );
    case "EMAIL":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5" aria-hidden="true">
          <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
          <path d="M4 7l8 6 8-6" />
        </svg>
      );
    case "WEBSITE":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5" aria-hidden="true">
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17M12 3.5c2.2 2.3 3.4 5.3 3.4 8.5s-1.2 6.2-3.4 8.5c-2.2-2.3-3.4-5.3-3.4-8.5S9.8 5.8 12 3.5z" />
        </svg>
      );
    case "OTHER":
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5" aria-hidden="true">
          <path d="M9.5 14.5l5-5M10.8 6.8l1-1a3.2 3.2 0 0 1 4.5 4.5l-1.4 1.4M13.2 17.2l-1 1a3.2 3.2 0 0 1-4.5-4.5l1.4-1.4" />
        </svg>
      );
  }
}
