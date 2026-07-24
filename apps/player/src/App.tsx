import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { NowPlayingDTO } from "@spectado/shared-types";
import { apiClient } from "./lib/apiClient";
import { AlbumArt } from "./components/AlbumArt";
import { TrackInfo } from "./components/TrackInfo";
import { PlayerControls } from "./components/PlayerControls";
import { AudioElement } from "./components/AudioElement";
import { ConnectionErrorBanner } from "./components/ConnectionErrorBanner";

/** Consecutive failed now-playing polls before we show the connection banner. */
const FAILURE_THRESHOLD = 3;

export function App() {
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);

  const nowPlayingQuery = useQuery({
    queryKey: ["public", "now-playing"],
    queryFn: () => apiClient.get<NowPlayingDTO>("/public/now-playing"),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (nowPlayingQuery.isSuccess) {
      setConsecutiveFailures(0);
    } else if (nowPlayingQuery.isError) {
      setConsecutiveFailures((c) => c + 1);
    }
    // dataUpdatedAt/errorUpdatedAt change on every fetch cycle (even when the
    // resulting isSuccess/isError value is unchanged from last time), which is
    // what lets us count *consecutive* failures across repeated polls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowPlayingQuery.dataUpdatedAt, nowPlayingQuery.errorUpdatedAt]);

  // Resume-from-background should feel instant rather than waiting for the
  // next 5s tick.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        nowPlayingQuery.refetch();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-slate-950 px-6 py-12">
      <AudioElement playing={playing} muted={muted} onError={setStreamError} />

      <AlbumArt
        coverArtUrl={nowPlayingQuery.data?.coverArtUrl ?? null}
        alt={nowPlayingQuery.data?.title ?? "Album art"}
      />

      <TrackInfo nowPlaying={nowPlayingQuery.data} />

      <PlayerControls
        playing={playing}
        muted={muted}
        onTogglePlay={() => setPlaying((p) => !p)}
        onToggleMute={() => setMuted((m) => !m)}
      />

      <div className="flex w-full max-w-xs flex-col gap-2">
        <ConnectionErrorBanner visible={consecutiveFailures >= FAILURE_THRESHOLD} />
        {streamError && (
          <div className="rounded-lg border border-red-900/50 bg-red-950/50 px-4 py-2 text-center text-sm text-red-300">
            {streamError}
          </div>
        )}
      </div>
    </div>
  );
}
