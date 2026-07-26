import { useEffect, useRef } from "react";
import Hls from "hls.js";

interface AudioElementProps {
  playing: boolean;
  muted: boolean;
  volume: number;
  // null clears a previously-reported error once the stream recovers on its own.
  onError?: (message: string | null) => void;
}

const STREAM_URL = "/master.m3u8";
const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;

/** Wraps a plain <audio> element, feeding it the live HLS stream via hls.js
 * where supported, falling back to the native HLS support Safari ships with.
 * Both paths auto-reconnect on a fatal stream error (encoder restart, a
 * transient network blip, a stale manifest) with exponential backoff instead
 * of leaving playback dead until the listener manually reloads the page. */
export function AudioElement({ playing, muted, volume, onError }: AudioElementProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const onErrorRef = useRef(onError);
  const playingRef = useRef(playing);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  // Set up the stream source exactly once — re-running this on every render
  // (e.g. because a parent passes a fresh onError closure) would tear down
  // and rebuild the HLS session pointlessly.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    let retryDelayMs = INITIAL_RETRY_DELAY_MS;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    function resumeIfPlaying() {
      if (playingRef.current) {
        audio!.play().catch(() => {
          // Autoplay may still be blocked without a prior user gesture -- the
          // next explicit Play click covers that, nothing more to do here.
        });
      }
    }

    // A fatal error always schedules exactly one retry: cancel any retry
    // still pending so back-to-back errors don't pile up overlapping timers.
    function scheduleRetry(fn: () => void) {
      if (retryTimeout) clearTimeout(retryTimeout);
      retryTimeout = setTimeout(() => {
        retryTimeout = null;
        fn();
      }, retryDelayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS);
    }

    function resetBackoff() {
      retryDelayMs = INITIAL_RETRY_DELAY_MS;
      onErrorRef.current?.(null);
    }

    if (Hls.isSupported()) {
      let hls = new Hls();

      function bind(instance: Hls) {
        // Proof the stream is healthy again -- a fragment only loads once
        // the manifest/segments are actually reachable.
        instance.on(Hls.Events.FRAG_LOADED, resetBackoff);

        instance.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          onErrorRef.current?.(`Stream error (${data.type}): ${data.details} -- reconnecting…`);

          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              scheduleRetry(() => {
                instance.startLoad();
                resumeIfPlaying();
              });
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              scheduleRetry(() => {
                instance.recoverMediaError();
                resumeIfPlaying();
              });
              break;
            default:
              // Not individually recoverable -- tear down and build a fresh
              // instance rather than leaving playback dead forever.
              scheduleRetry(() => {
                instance.destroy();
                hls = new Hls();
                bind(hls);
                hls.loadSource(STREAM_URL);
                hls.attachMedia(audio!);
                resumeIfPlaying();
              });
              break;
          }
        });
      }

      bind(hls);
      hls.loadSource(STREAM_URL);
      hls.attachMedia(audio);

      return () => {
        if (retryTimeout) clearTimeout(retryTimeout);
        hls.destroy();
      };
    }

    if (audio.canPlayType("application/vnd.apple.mpegurl")) {
      audio.src = STREAM_URL;

      function handleNativeError() {
        onErrorRef.current?.("Stream error -- reconnecting…");
        scheduleRetry(() => {
          audio!.src = STREAM_URL;
          audio!.load();
          resumeIfPlaying();
        });
      }

      audio.addEventListener("error", handleNativeError);
      // Native HLS has no fragment-load event to hook -- "playing" (frames
      // are actually being rendered) is the closest proxy for "recovered".
      audio.addEventListener("playing", resetBackoff);

      return () => {
        if (retryTimeout) clearTimeout(retryTimeout);
        audio.removeEventListener("error", handleNativeError);
        audio.removeEventListener("playing", resetBackoff);
        audio.removeAttribute("src");
        audio.load();
      };
    }

    onErrorRef.current?.("This browser can't play the live stream.");
    return undefined;
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.muted = muted;
  }, [muted]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.play().catch((err) => {
        onErrorRef.current?.(
          err instanceof Error ? err.message : "Playback was blocked by the browser.",
        );
      });
    } else {
      audio.pause();
    }
  }, [playing]);

  // eslint-disable-next-line jsx-a11y/media-has-caption
  return <audio ref={audioRef} preload="none" />;
}
