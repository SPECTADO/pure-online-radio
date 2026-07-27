import type { MediaKind } from "@spectado/shared-types";

const MEDIA_KIND_STYLES: Record<MediaKind, string> = {
  SONG: "bg-green-600 text-white",
  JINGLE: "bg-blue-600 text-white",
  AD: "bg-red-600 text-white",
  VOICE_TRACK: "bg-purple-600 text-white",
};

export function MediaKindBadge({ kind }: { kind: MediaKind }) {
  return (
    <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${MEDIA_KIND_STYLES[kind]}`}>
      {kind}
    </span>
  );
}
