import { z } from "zod";
import { ExternalStreamEndBehaviorSchema, ExternalStreamStatusSchema, ScheduleTriggerTypeSchema } from "./common.js";
import { refineScheduleTrigger, ScheduleTriggerSchema } from "./schedule-trigger.js";

export const ExternalStreamSchema = ScheduleTriggerSchema.extend({
  id: z.string(),
  name: z.string(),
  url: z.string().url(),
  status: ExternalStreamStatusSchema,
  lastTriggeredAt: z.string().datetime().nullable(),
  endBehavior: ExternalStreamEndBehaviorSchema,
  endAt: z.string().datetime().nullable(), // required (below) when endBehavior = AT_TIME
  durationMs: z.number().int().positive().nullable(), // required (below) when endBehavior = AFTER_DURATION
  startedAt: z.string().datetime().nullable(), // actual runtime start of the current/most recent PLAYING run
});
export type ExternalStreamDTO = z.infer<typeof ExternalStreamSchema>;

function refineEndBehavior(
  data: {
    triggerType: z.infer<typeof ScheduleTriggerTypeSchema>;
    endBehavior: z.infer<typeof ExternalStreamEndBehaviorSchema>;
    endAt?: unknown;
    durationMs?: unknown;
  },
  ctx: z.RefinementCtx,
): void {
  if (data.endBehavior === "AT_TIME" && !data.endAt) {
    ctx.addIssue({ code: "custom", message: "endAt is required when endBehavior is AT_TIME", path: ["endAt"] });
  }
  if (data.endBehavior === "AFTER_DURATION" && !data.durationMs) {
    ctx.addIssue({
      code: "custom",
      message: "durationMs is required when endBehavior is AFTER_DURATION",
      path: ["durationMs"],
    });
  }
  // An absolute AT_TIME endAt can't recur sensibly across WEEKLY/INTERVAL/PLAY_COUNT
  // occurrences (the next occurrence would already be past a fixed past timestamp) --
  // only meaningful paired with a ONE_TIME trigger.
  if (data.endBehavior === "AT_TIME" && data.triggerType !== "ONE_TIME") {
    ctx.addIssue({
      code: "custom",
      message: "endBehavior AT_TIME is only valid with a ONE_TIME trigger",
      path: ["endBehavior"],
    });
  }
}

export const CreateExternalStreamRequestSchema = ScheduleTriggerSchema.extend({
  name: z.string().min(1),
  url: z.string().url(),
  endBehavior: ExternalStreamEndBehaviorSchema.default("NATURAL"),
  endAt: z.string().datetime().nullable().optional(),
  durationMs: z.number().int().positive().nullable().optional(),
}).superRefine((data, ctx) => {
  refineScheduleTrigger(data, ctx);
  refineEndBehavior(data, ctx);
});
export type CreateExternalStreamRequestDTO = z.infer<typeof CreateExternalStreamRequestSchema>;
