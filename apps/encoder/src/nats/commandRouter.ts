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
import type { QueueController } from "../controllers/queueController.js";
import type { JingleController } from "../controllers/jingleController.js";
import type { RelayController } from "../controllers/relayController.js";
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

export interface CommandControllers {
  queueController: QueueController;
  jingleController: JingleController;
  relayController: RelayController;
}

/**
 * REAL: subscribes to every `radio.encoder.cmd.*` subject (via
 * NATS_WILDCARDS.cmd), validates each payload against its matching schema,
 * and dispatches `advance`/`setMode`/`jingle.play`/`jingle.stop`/`relay.*` to
 * the real queueController/jingleController/relayController. `live.*` keeps
 * the original pass's behavior (validate + ack `true`, no dispatch) -- mic
 * mixing is still untouched, out of scope here.
 */
export function startCommandRouter(natsClient: NatsClient, logger: Logger, controllers: CommandControllers): void {
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
    logger.info({ subject, command: entry.name, commandId, payload: parsed.data }, `received cmd ${entry.name}`);

    void dispatch(subject, parsed.data, controllers).catch((err: unknown) => {
      logger.error({ err, subject, command: entry.name }, "command handler threw");
    });

    publishAck(natsClient, logger, { commandId: commandId ?? "unknown", ok: true, error: null });
  });

  logger.info({ subject: NATS_WILDCARDS.cmd }, "command router subscribed");
}

async function dispatch(subject: string, data: unknown, controllers: CommandControllers): Promise<void> {
  switch (subject) {
    case NATS_SUBJECTS.cmd.advance:
      await controllers.queueController.handleAdvance(data as z.infer<typeof AdvanceCommandSchema>);
      return;
    case NATS_SUBJECTS.cmd.setMode:
      await controllers.queueController.handleSetMode(data as z.infer<typeof SetModeCommandSchema>);
      return;
    case NATS_SUBJECTS.cmd.jinglePlay:
      await controllers.jingleController.handleJinglePlay(data as z.infer<typeof JinglePlayCommandSchema>);
      return;
    case NATS_SUBJECTS.cmd.jingleStop:
      await controllers.jingleController.handleJingleStop(data as z.infer<typeof JingleStopCommandSchema>);
      return;
    case NATS_SUBJECTS.cmd.relayStart:
      await controllers.relayController.handleRelayStart(data as z.infer<typeof RelayStartCommandSchema>);
      return;
    case NATS_SUBJECTS.cmd.relayStop:
      await controllers.relayController.handleRelayStop(data as z.infer<typeof RelayStopCommandSchema>);
      return;
    case NATS_SUBJECTS.cmd.relayCancel:
      await controllers.relayController.handleRelayCancel(data as z.infer<typeof RelayCancelCommandSchema>);
      return;
    default:
      // live.*: untouched stub, no dispatch -- already ack'd above.
      return;
  }
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
