import { useEffect, useState } from "react";
import { connect as natsConnect, JSONCodec, type NatsConnection } from "nats.ws";
import type { NatsCredentialsDTO } from "@spectado/shared-types";
import { apiClient } from "./apiClient";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

type StatusHandler = (status: ConnectionStatus) => void;
type MessageHandler = (data: unknown, subject: string) => void;

const codec = JSONCodec();

/**
 * Subscribe-only NATS-over-websocket client. Fetches short-lived credentials
 * from the API (never talks to NATS directly for auth) and fans out incoming
 * messages, keyed by their exact subject, to whoever registered interest via
 * `onMessage`/`useNatsSubject`. Control-panel never publishes here — all
 * commands go browser -> HTTP -> api -> NATS.
 */
class NatsClient {
  private nc: NatsConnection | null = null;
  private status: ConnectionStatus = "disconnected";
  private connecting: Promise<void> | null = null;
  private statusHandlers = new Set<StatusHandler>();
  private messageHandlers = new Map<string, Set<MessageHandler>>();

  getStatus(): ConnectionStatus {
    return this.status;
  }

  onStatusChange(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  /** Register interest in an exact NATS subject (e.g. NATS_SUBJECTS.encoderStatus.nowPlaying). */
  onMessage(subject: string, handler: MessageHandler): () => void {
    let set = this.messageHandlers.get(subject);
    if (!set) {
      set = new Set();
      this.messageHandlers.set(subject, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  async connect(): Promise<void> {
    if (this.status === "connected" || this.connecting) {
      return this.connecting ?? Promise.resolve();
    }

    this.connecting = this.doConnect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private setStatus(status: ConnectionStatus) {
    this.status = status;
    this.statusHandlers.forEach((h) => h(status));
  }

  private async doConnect(): Promise<void> {
    this.setStatus("connecting");
    try {
      const creds = await apiClient.get<NatsCredentialsDTO>("/realtime/nats-credentials");
      const nc = await natsConnect({
        servers: creds.url,
        user: creds.user,
        pass: creds.password,
      });
      this.nc = nc;
      this.setStatus("connected");

      nc.closed().then(() => {
        this.nc = null;
        this.setStatus("disconnected");
      });

      for (const subject of creds.allowedSubjects) {
        const sub = nc.subscribe(subject);
        (async () => {
          for await (const msg of sub) {
            let data: unknown;
            try {
              data = codec.decode(msg.data);
            } catch {
              continue;
            }
            this.messageHandlers.get(msg.subject)?.forEach((h) => h(data, msg.subject));
          }
        })();
      }
    } catch (err) {
      this.nc = null;
      this.setStatus("error");
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    await this.nc?.close();
    this.nc = null;
    this.setStatus("disconnected");
  }
}

export const natsClient = new NatsClient();

/** React hook: live connection status, for ConnectionStatusBadge and friends. */
export function useConnectionStatus(): ConnectionStatus {
  const [status, setStatus] = useState(natsClient.getStatus());
  useEffect(() => natsClient.onStatusChange(setStatus), []);
  return status;
}

/** React hook: subscribe a component to a single exact NATS subject's messages. */
export function useNatsSubject<T = unknown>(subject: string, handler: (data: T) => void): void {
  useEffect(() => {
    return natsClient.onMessage(subject, (data) => handler(data as T));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject]);
}
