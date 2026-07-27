/**
 * Resolves a song's (possibly-unset) crossfade mix points against the
 * station-wide defaults into four concrete, in-bounds millisecond values.
 *
 * `null` on any field means "use the default": mix-in point defaults to the
 * very start of the track (0), mix-out point defaults to
 * `durationMs - defaultMixOutDurationMs` (i.e. fade out over the configured
 * default length, finishing exactly at the natural end). Every returned value
 * is clamped to `[0, durationMs]` and the two durations are shortened if
 * needed so neither fade runs past the track's own length -- callers (the
 * API building a playback directive, the control panel previewing an
 * unedited song) never have to defensively re-clamp.
 */

export interface SongMixPointsInput {
  durationMs: number;
  mixInPointMs: number | null;
  mixInDurationMs: number | null;
  mixOutPointMs: number | null;
  mixOutDurationMs: number | null;
}

export interface MixDefaultsInput {
  defaultMixInDurationMs: number;
  defaultMixOutDurationMs: number;
}

export interface ResolvedMixPoints {
  mixInPointMs: number;
  mixInDurationMs: number;
  mixOutPointMs: number;
  mixOutDurationMs: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function resolveMixPoints(song: SongMixPointsInput, defaults: MixDefaultsInput): ResolvedMixPoints {
  const durationMs = Math.max(0, song.durationMs);

  const mixInPointMs = clamp(song.mixInPointMs ?? 0, 0, durationMs);
  const mixInDurationMsRaw = song.mixInDurationMs ?? defaults.defaultMixInDurationMs;
  const mixInDurationMs = clamp(mixInDurationMsRaw, 0, durationMs - mixInPointMs);

  const mixOutDurationMsRaw = song.mixOutDurationMs ?? defaults.defaultMixOutDurationMs;
  const mixOutPointMsRaw = song.mixOutPointMs ?? Math.max(0, durationMs - mixOutDurationMsRaw);
  const mixOutPointMs = clamp(mixOutPointMsRaw, mixInPointMs, durationMs);
  const mixOutDurationMs = clamp(mixOutDurationMsRaw, 0, durationMs - mixOutPointMs);

  return { mixInPointMs, mixInDurationMs, mixOutPointMs, mixOutDurationMs };
}
