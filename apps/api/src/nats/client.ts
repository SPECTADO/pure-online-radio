import { connect, StringCodec, type NatsConnection } from "nats";
import type { z } from "zod";
import { config } from "../config/env.js";
import { logger } from "../logger.js";

const sc = StringCodec();

let connection: NatsConnection | undefined;

/** Connects to NATS using the `api` user (see config/env.ts). Call once at bootstrap. */
export async function connectNats(): Promise<NatsConnection> {
  if (connection) {
    return connection;
  }

  connection = await connect({
    servers: config.nats.url,
    user: config.nats.user,
    pass: config.nats.password,
    name: "spectado-api",
  });

  logger.info({ url: config.nats.url }, "[nats] connected");

  connection.closed().then((err) => {
    if (err) {
      logger.error({ err }, "[nats] connection closed with error");
    } else {
      logger.info("[nats] connection closed");
    }
  });

  return connection;
}

export function getNatsConnection(): NatsConnection {
  if (!connection) {
    throw new Error("NATS connection not initialized -- call connectNats() during bootstrap first");
  }
  return connection;
}

/** Used by GET /healthz. */
export function isNatsConnected(): boolean {
  return connection !== undefined && !connection.isClosed();
}

/**
 * Used by the system status page. NATS's monitoring HTTP port (8222, see the
 * `nats` service's healthcheck in docker-compose.yml) is only reachable
 * inside the compose network -- fine here since the api always runs there.
 * Derives the host from `config.nats.url` rather than hardcoding "nats" so
 * this keeps working if that ever changes.
 */
export async function getNatsUptimeSec(): Promise<number | null> {
  try {
    const host = new URL(config.nats.url).hostname;
    const res = await fetch(`http://${host}:8222/varz`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    const varz = (await res.json()) as { start?: string };
    if (!varz.start) return null;
    return (Date.now() - new Date(varz.start).getTime()) / 1000;
  } catch {
    return null;
  }
}

export async function disconnectNats(): Promise<void> {
  if (connection) {
    await connection.drain();
    connection = undefined;
  }
}

/** Validates `payload` against `schema`, then publishes it JSON-encoded to `subject`. Throws on schema failure. */
export function publish<T>(subject: string, schema: z.ZodType<T>, payload: T): void {
  const validated = schema.parse(payload);
  getNatsConnection().publish(subject, sc.encode(JSON.stringify(validated)));
}

/**
 * Subscribes to a single, fully-typed subject (no wildcards). Malformed
 * messages are logged and dropped rather than crashing the subscription.
 */
export function subscribeTyped<T>(
  subject: string,
  schema: z.ZodType<T>,
  handler: (payload: T) => void | Promise<void>,
): void {
  const sub = getNatsConnection().subscribe(subject);
  void (async () => {
    for await (const msg of sub) {
      try {
        const parsed = schema.parse(JSON.parse(sc.decode(msg.data)));
        await handler(parsed);
      } catch (err) {
        logger.warn({ err, subject: msg.subject }, "[nats] failed to handle message");
      }
    }
  })().catch((err) => {
    logger.error({ err, subject }, "[nats] subscription loop crashed");
  });
}

/**
 * Subscribes to a subject pattern that may span several distinct message
 * shapes (e.g. a wildcard like `radio.encoder.status.>`). The handler
 * receives the raw decoded JSON plus the concrete subject the message
 * arrived on, and is responsible for picking + applying the right zod schema
 * per subject -- see nats/subscriber.ts.
 */
export function subscribeRaw(
  subjectPattern: string,
  handler: (subject: string, data: unknown) => void | Promise<void>,
): void {
  const sub = getNatsConnection().subscribe(subjectPattern);
  void (async () => {
    for await (const msg of sub) {
      try {
        const data: unknown = JSON.parse(sc.decode(msg.data));
        await handler(msg.subject, data);
      } catch (err) {
        logger.warn({ err, subject: msg.subject }, "[nats] failed to parse/handle message");
      }
    }
  })().catch((err) => {
    logger.error({ err, subjectPattern }, "[nats] subscription loop crashed");
  });
}
