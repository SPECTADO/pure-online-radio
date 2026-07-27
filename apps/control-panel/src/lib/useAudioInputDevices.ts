import { useEffect, useState } from "react";

export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

/**
 * Lists the manager's available microphones. Browsers withhold device `label`s until mic
 * permission has been granted at least once, so this requests a throwaway getUserMedia stream
 * first (stopped immediately, before any real recording/broadcast starts) purely to unlock
 * labels, then enumerates for real. Shared by the Dashboard's live-mic controls and the Voice
 * Track recorder -- both need the exact same device list.
 */
export function useAudioInputDevices(): { devices: AudioInputDevice[]; error: string | null } {
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const unlockStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        unlockStream.getTracks().forEach((track) => track.stop());

        const all = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const inputs = all
          .filter((d) => d.kind === "audioinput")
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
        setDevices(inputs);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't access the microphone");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { devices, error };
}
