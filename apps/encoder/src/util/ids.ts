import { randomUUID } from "node:crypto";

/** Generates a random id, used for correlating log lines / future internal request ids. */
export function generateId(): string {
  return randomUUID();
}
