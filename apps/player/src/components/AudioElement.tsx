import { useEffect, useRef } from "react";
import Hls from "hls.js";

interface AudioElementProps {
  playing: boolean;
  muted: boolean;
  volume: number;
  onError?: (message: string) => void;
}

const STREAM_URL = "/master.m3u8";

/** Wraps a plain <audio> element, feeding it the live HLS stream via hls.js
 * where supported, falling back to the native HLS support Safari ships with. */
export function AudioElement({ playing, muted, volume, onError }: AudioElementProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Set up the stream source exactly once — re-running this on every render
  // (e.g. because a parent passes a fresh onError closure) would tear down
  // and rebuild the HLS session pointlessly.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(STREAM_URL);
      hls.attachMedia(audio);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          onErrorRef.current?.(`Stream error (${data.type}): ${data.details}`);
        }
      });
      return () => hls.destroy();
    }

    if (audio.canPlayType("application/vnd.apple.mpegurl")) {
      audio.src = STREAM_URL;
      return () => {
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
