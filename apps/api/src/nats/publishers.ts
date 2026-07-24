import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { prisma, type Prisma } from "@spectado/database";
import {
  AdvanceCommandSchema,
  NATS_SUBJECTS,
  SetModeCommandSchema,
  type AdvanceCommand,
  type PlaybackMode,
  type SetModeCommand,
} from "@spectado/shared-types";
import { publish } from "./client.js";

/** Publishes to NATS and always writes a CommandAuditLog row, regardless of outcome. */
async function auditAndPublish<T extends Record<string, unknown>>(
  subject: string,
  schema: z.ZodType<T>,
  payload: T,
  userId: string | null,
): Promise<void> {
  let result = "published";
  try {
    publish(subject, schema, payload);
  } catch (err) {
    result = `rejected: ${err instanceof Error ? err.message : String(err)}`;
    throw err;
  } finally {
    await prisma.commandAuditLog.create({
      data: { userId, commandSubject: subject, payload: payload as unknown as Prisma.InputJsonValue, result },
    });
  }
}

export async function publishAdvanceCommand(params: {
  requestedBy: string | null;
  reason: AdvanceCommand["reason"];
  userId: string | null;
}): Promise<AdvanceCommand> {
  const command: AdvanceCommand = {
    commandId: randomUUID(),
    requestedBy: params.requestedBy,
    reason: params.reason,
  };
  await auditAndPublish(NATS_SUBJECTS.cmd.advance, AdvanceCommandSchema, command, params.userId);
  return command;
}

export async function publishSetModeCommand(params: {
  mode: PlaybackMode;
  userId: string | null;
}): Promise<SetModeCommand> {
  const command: SetModeCommand = {
    commandId: randomUUID(),
    mode: params.mode,
  };
  await auditAndPublish(NATS_SUBJECTS.cmd.setMode, SetModeCommandSchema, command, params.userId);
  return command;
}
