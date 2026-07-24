import { PlaybackDirectiveSchema, type PlaybackDirectiveDTO } from "@spectado/shared-types";
import type { EncoderConfig } from "../config.js";
import type { Logger } from "../util/logger.js";

/**
 * REAL: polls `${API_CALLBACK_URL}/playback/next` on an interval, purely to
 * prove connectivity/shape for this pass - nothing consumes the returned
 * directive yet (that's queueController's job once it's real). The API is
 * expected to almost always return `{type:"silence", ...}` right now, and
 * that is treated as a perfectly normal result, not an error.
 *
 * Must never crash the process: network errors, timeouts, non-2xx statuses,
 * and schema validation failures are all logged and swallowed, and the next
 * poll just tries again.
 */
export class ApiClient {
  private timer: NodeJS.Timeout | null = null;

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

  startPolling(intervalMs: number = this.config.apiPollIntervalMs): void {
    if (this.timer) return;
    const tick = (): void => {
      void this.fetchNextDirective();
    };
    tick();
    this.timer = setInterval(tick, intervalMs);
  }

  stopPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
