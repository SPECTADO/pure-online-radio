import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { prisma, type Prisma } from "@spectado/database";
import {
  AdvanceCommandSchema,
  JinglePlayCommandSchema,
  JingleStopCommandSchema,
  NATS_SUBJECTS,
  QueueUpdatedBroadcastSchema,
  RelayCancelCommandSchema,
  RelayStartCommandSchema,
  RelayStopCommandSchema,
  SetModeCommandSchema,
  type AdvanceCommand,
  type JinglePlayCommand,
  type JingleStopCommand,
  type PlaybackMode,
  type RelayCancelCommand,
  type RelayStartCommand,
  type RelayStopCommand,
  type SetModeCommand,
} from "@spectado/shared-types";
import { getPresignedGetUrl } from "../lib/storage.js";
import { publish } from "./client.js";

const JINGLE_URL_BUFFER_SECONDS = 120;

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

export async function publishJinglePlayCommand(params: {
  jingle: { id: string; title: string; fileKey: string; durationMs: number };
  userId: string | null;
}): Promise<JinglePlayCommand> {
  const ttlSeconds = Math.ceil(params.jingle.durationMs / 1000) + JINGLE_URL_BUFFER_SECONDS;
  const url = await getPresignedGetUrl(params.jingle.fileKey, ttlSeconds);
  const command: JinglePlayCommand = {
    commandId: randomUUID(),
    jingleId: params.jingle.id,
    title: params.jingle.title,
    durationMs: params.jingle.durationMs,
    url,
    duckDb: -14,
    fadeInMs: 300,
    fadeOutMs: 800,
  };
  await auditAndPublish(NATS_SUBJECTS.cmd.jinglePlay, JinglePlayCommandSchema, command, params.userId);
  return command;
}

export async function publishJingleStopCommand(params: {
  userId: string | null;
}): Promise<JingleStopCommand> {
  const command: JingleStopCommand = { commandId: randomUUID() };
  await auditAndPublish(NATS_SUBJECTS.cmd.jingleStop, JingleStopCommandSchema, command, params.userId);
  return command;
}

export async function publishRelayStartCommand(params: {
  relayId: string;
  name: string;
  url: string;
  startAt: Date;
  endAt: Date | null;
  userId: string | null;
}): Promise<RelayStartCommand> {
  const command: RelayStartCommand = {
    commandId: randomUUID(),
    relayId: params.relayId,
    name: params.name,
    url: params.url,
    startAt: params.startAt.toISOString(),
    endAt: params.endAt ? params.endAt.toISOString() : null,
    onFailure: "fallbackToQueue",
  };
  await auditAndPublish(NATS_SUBJECTS.cmd.relayStart, RelayStartCommandSchema, command, params.userId);
  return command;
}

export async function publishRelayStopCommand(params: {
  relayId: string;
  userId: string | null;
}): Promise<RelayStopCommand> {
  const command: RelayStopCommand = { commandId: randomUUID(), relayId: params.relayId };
  await auditAndPublish(NATS_SUBJECTS.cmd.relayStop, RelayStopCommandSchema, command, params.userId);
  return command;
}

export async function publishRelayCancelCommand(params: {
  relayId: string;
  userId: string | null;
}): Promise<RelayCancelCommand> {
  const command: RelayCancelCommand = { commandId: randomUUID(), relayId: params.relayId };
  await auditAndPublish(NATS_SUBJECTS.cmd.relayCancel, RelayCancelCommandSchema, command, params.userId);
  return command;
}

/** UI-only broadcast (not an encoder command) -- no CommandAuditLog row, matching
 * why ModeControlBroadcast/AlertBroadcast aren't audited either. */
export async function publishQueueUpdated(reason: string): Promise<void> {
  publish(NATS_SUBJECTS.control.queueUpdated, QueueUpdatedBroadcastSchema, {
    ts: new Date().toISOString(),
    reason,
  });
}
