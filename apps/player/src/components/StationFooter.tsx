import type { StationLinkDTO } from "@spectado/shared-types";
import { StationLinkIcon } from "./StationLinkIcon";

export function StationFooter({ links }: { links: StationLinkDTO[] }) {
  if (links.length === 0) return null;

  return (
    <footer className="flex flex-wrap items-center justify-center gap-4 px-4 pb-6 pt-2 sm:gap-5 sm:pb-8">
      {links.map((link) => (
        <a
          key={`${link.platform}-${link.url}`}
          href={link.url}
          target="_blank"
          rel="noreferrer"
          aria-label={link.label ?? link.platform}
          title={link.label ?? link.platform}
          className="text-slate-500 transition hover:text-white"
        >
          <StationLinkIcon platform={link.platform} />
        </a>
      ))}
    </footer>
  );
}
