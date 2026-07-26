import { PlaybackDirectiveSchema, StreamSettingsSchema, type PlaybackDirectiveDTO, type StreamSettingsDTO } from "@spectado/shared-types";
import type { EncoderConfig } from "../config.js";
import type { Logger } from "../util/logger.js";

/**
 * Used only if `/internal/stream-settings` can't be reached at boot (API not
 * up yet, network error) -- matches this pipeline's original hardcoded
 * values, so a fresh/unreachable install behaves exactly as it did before
 * Stream Settings existed rather than failing to produce a stream at all.
 */
export const DEFAULT_STREAM_SETTINGS: StreamSettingsDTO = {
  codec: "AAC",
  lowBitrateKbps: 64,
  highBitrateKbps: 256,
  segmentSeconds: 4,
  segmentCount: 8,
  lowLatencyEnabled: false,
  updatedAt: new Date(0).toISOString(),
};

/**
 * REAL: fetches `${API_CALLBACK_URL}/playback/next` on demand.
 *
 * IMPORTANT: this endpoint has a real side effect -- it atomically dequeues
 * the head of the manual queue server-side (see api's internal.routes.ts).
 * `fetchNextDirective()` must therefore only ever be called by
 * queueController's own advance-driven schedule (boot, track-ended, explicit
 * AdvanceCommand, or a silence directive's retryAfterMs). A second caller
 * polling on a fixed interval alongside that would double-claim/skip queue
 * items unpredictably -- this class deliberately has no interval of its own.
 *
 * Must never crash the process: network errors, timeouts, non-2xx statuses,
 * and schema validation failures are all logged and swallowed, returning
 * `null` so the caller can decide how to retry.
 */
export class ApiClient {
  constructor(
    private readonly config: EncoderConfig,
    private readonly logger: Logger,
  ) {}

  async fetchNextDirective(): Promise<PlaybackDirectiveDTO | null> {
    const url = `${this.config.apiCallbackUrl}/playback/next`;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.config.apiTimeoutMs);

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.config.apiCallbackToken}` },
        signal: controller.signal,
      });

      if (!res.ok) {
        this.logger.warn({ url, status: res.status }, "playback/next returned a non-OK status");
        return null;
      }

      const json: unknown = await res.json();
      const parsed = PlaybackDirectiveSchema.safeParse(json);
      if (!parsed.success) {
        this.logger.error({ url, issues: parsed.error.issues }, "playback/next response failed schema validation");
        return null;
      }

      this.logger.info({ directive: parsed.data }, "fetched playback directive");
      return parsed.data;
    } catch (err) {
      // Covers network errors, DNS failures (api not up yet), and abort
      // timeouts - all expected/recoverable states while the API side of
      // the stack is still coming up.
      this.logger.warn({ url, err }, "playback/next request failed; will retry next poll");
      return null;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /**
   * Fetches `${API_CALLBACK_URL}/stream-settings` -- read-only, no dequeue-style
   * side effect, so unlike fetchNextDirective() this is safe to retry freely.
   * Called once at boot (see index.ts); there is no live-reload path today.
   */
  async fetchStreamSettings(): Promise<StreamSettingsDTO | null> {
    const url = `${this.config.apiCallbackUrl}/stream-settings`;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.config.apiTimeoutMs);

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.config.apiCallbackToken}` },
        signal: controller.signal,
      });

      if (!res.ok) {
        this.logger.warn({ url, status: res.status }, "stream-settings returned a non-OK status");
        return null;
      }

      const json: unknown = await res.json();
      const parsed = StreamSettingsSchema.safeParse(json);
      if (!parsed.success) {
        this.logger.error({ url, issues: parsed.error.issues }, "stream-settings response failed schema validation");
        return null;
      }

      return parsed.data;
    } catch (err) {
      this.logger.warn({ url, err }, "stream-settings request failed");
      return null;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}
