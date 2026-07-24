import type { NowPlayingDTO } from "@spectado/shared-types";

interface TrackInfoProps {
  nowPlaying: NowPlayingDTO | undefined;
}

export function TrackInfo({ nowPlaying }: TrackInfoProps) {
  if (!nowPlaying || !nowPlaying.isLive) {
    return (
      <div className="text-center">
        <p className="text-lg font-medium text-slate-300">Off air</p>
        <p className="text-sm text-slate-500">Back shortly &mdash; thanks for listening.</p>
      </div>
    );
  }

  return (
    <div className="text-center">
      <p className="truncate text-xl font-semibold text-white">
        {nowPlaying.title ?? "Live broadcast"}
      </p>
      <p className="truncate text-sm text-slate-400">
        {nowPlaying.artist ?? " "}
        {nowPlaying.album ? ` · ${nowPlaying.album}` : ""}
      </p>
    </div>
  );
}
