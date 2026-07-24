import { connect, JSONCodec, type NatsConnection, type Subscription } from "nats";
import type { EncoderConfig } from "../config.js";
import type { Logger } from "../util/logger.js";

const jsonCodec = JSONCodec();

/**
 * Thin real wrapper around the `nats` client: connects using
 * NATS_URL/NATS_USER/NATS_PASSWORD and exposes small publish/subscribe
 * helpers that speak JSON, matching the zod schemas in @spectado/shared-types.
 */
export class NatsClient {
  private constructor(
    private readonly nc: NatsConnection,
    private readonly logger: Logger,
  ) {}

  static async connect(config: EncoderConfig, logger: Logger): Promise<NatsClient> {
    const nc = await connect({
      servers: config.natsUrl,
      user: config.natsUser,
      pass: config.natsPassword,
      name: "spectado-encoder",
      reconnect: true,
      maxReconnectAttempts: -1,
    });
    logger.info({ server: nc.getServer() }, "connected to NATS");
    return new NatsClient(nc, logger);
  }

  /** Publishes a JSON-serializable payload on `subject`. */
  publish(subject: string, payload: unknown): void {
    this.nc.publish(subject, jsonCodec.encode(payload));
  }

  /**
   * Subscribes to a subject or wildcard, invoking `onMessage` with the
   * decoded JSON payload for every message. Decode/handler errors are
   * caught and logged per-message so one bad message can't kill the whole
   * subscription loop.
   */
  subscribe(subjectOrWildcard: string, onMessage: (subject: string, data: unknown) => void): Subscription {
    const sub = this.nc.subscribe(subjectOrWildcard);
    void (async () => {
      for await (const msg of sub) {
        let data: unknown;
        try {
          data = jsonCodec.decode(msg.data);
        } catch (err) {
          this.logger.warn({ err, subject: msg.subject }, "failed to JSON-decode NATS message");
          continue;
        }
        try {
          onMessage(msg.subject, data);
        } catch (err) {
          this.logger.error({ err, subject: msg.subject }, "NATS message handler threw");
        }
      }
    })().catch((err: unknown) => {
      this.logger.error({ err, subject: subjectOrWildcard }, "NATS subscription loop crashed");
    });
    return sub;
  }

  async close(): Promise<void> {
    await this.nc.drain();
  }
}
