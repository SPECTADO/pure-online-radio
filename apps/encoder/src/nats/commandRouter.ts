import {
  NATS_SUBJECTS,
  NATS_WILDCARDS,
  AdvanceCommandSchema,
  SetModeCommandSchema,
  JinglePlayCommandSchema,
  JingleStopCommandSchema,
  LiveStartCommandSchema,
  LiveStopCommandSchema,
  RelayStartCommandSchema,
  RelayStopCommandSchema,
  RelayCancelCommandSchema,
  CommandAckStatusSchema,
  type CommandAckStatus,
} from "@spectado/shared-types";
import type { z } from "zod";
import type { NatsClient } from "./natsClient.js";
import type { Logger } from "../util/logger.js";

interface CommandEntry {
  name: string;
  schema: z.ZodTypeAny;
}

/**
 * Maps every concrete `radio.encoder.cmd.*` subject to its zod schema from
 * @spectado/shared-types, so the router can validate on the way in without
 * redefining any schema itself.
 */
const COMMAND_SCHEMAS: Record<string, CommandEntry> = {
  [NATS_SUBJECTS.cmd.advance]: { name: "advance", schema: AdvanceCommandSchema },
  [NATS_SUBJECTS.cmd.setMode]: { name: "setMode", schema: SetModeCommandSchema },
  [NATS_SUBJECTS.cmd.jinglePlay]: { name: "jingle.play", schema: JinglePlayCommandSchema },
  [NATS_SUBJECTS.cmd.jingleStop]: { name: "jingle.stop", schema: JingleStopCommandSchema },
  [NATS_SUBJECTS.cmd.liveStart]: { name: "live.start", schema: LiveStartCommandSchema },
  [NATS_SUBJECTS.cmd.liveStop]: { name: "live.stop", schema: LiveStopCommandSchema },
  [NATS_SUBJECTS.cmd.relayStart]: { name: "relay.start", schema: RelayStartCommandSchema },
  [NATS_SUBJECTS.cmd.relayStop]: { name: "relay.stop", schema: RelayStopCommandSchema },
  [NATS_SUBJECTS.cmd.relayCancel]: { name: "relay.cancel", schema: RelayCancelCommandSchema },
};

/**
 * REAL: subscribes to every `radio.encoder.cmd.*` subject (via
 * NATS_WILDCARDS.cmd), validates each payload against its matching schema,
 * logs receipt, and always acks on NATS_SUBJECTS.encoderStatus.commandAck -
 * but does NOT dispatch to the stub controllers with real behavior yet.
 * That wiring (queueController.handleAdvance, jingleController.handlePlay,
 * etc.) is a TODO for the pass that makes those controllers real.
 */
export function startCommandRouter(natsClient: NatsClient, logger: Logger): void {
  natsClient.subscribe(NATS_WILDCARDS.cmd, (subject, data) => {
    const entry = COMMAND_SCHEMAS[subject];
    if (!entry) {
      logger.warn({ subject }, "received command on unrecognized subject");
      return;
    }

    const parsed = entry.schema.safeParse(data);
    if (!parsed.success) {
      logger.error({ subject, command: entry.name, issues: parsed.error.issues }, "command payload failed schema validation");
      const commandId = extractCommandId(data);
      if (commandId) {
        publishAck(natsClient, logger, { commandId, ok: false, error: parsed.error.message });
      }
      return;
    }

    const commandId = extractCommandId(parsed.data);
    logger.info({ subject, command: entry.name, commandId, payload: parsed.data }, `received cmd ${entry.name}, not yet actioned`);

    // TODO: dispatch to queueController / jingleController / liveMicController /
    // relayController here once they have real behavior instead of logging.

    publishAck(natsClient, logger, { commandId: commandId ?? "unknown", ok: true, error: null });
  });

  logger.info({ subject: NATS_WILDCARDS.cmd }, "command router subscribed");
}

function extractCommandId(data: unknown): string | null {
  if (typeof data === "object" && data !== null && "commandId" in data) {
    const value = (data as { commandId: unknown }).commandId;
    if (typeof value === "string") return value;
  }
  return null;
}

function publishAck(natsClient: NatsClient, logger: Logger, ack: CommandAckStatus): void {
  const validated = CommandAckStatusSchema.parse(ack);
  natsClient.publish(NATS_SUBJECTS.encoderStatus.commandAck, validated);
  logger.debug({ ack: validated }, "published command ack");
}
