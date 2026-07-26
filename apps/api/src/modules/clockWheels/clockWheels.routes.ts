import { type Response, Router } from "express";
import { Prisma, prisma } from "@spectado/database";
import { ClockWheelSchema, UpsertClockWheelRequestSchema, type ClockWheelDTO } from "@spectado/shared-types";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { formatTimeOfDay, parseTimeOfDay } from "../../lib/scheduleTrigger.js";
import { slotsOverlap } from "../../lib/clockWheelSlot.js";

export const clockWheelsRoutes = Router();

clockWheelsRoutes.use(requireAuth, requireRole("MANAGER", "ADMIN"));

const wheelInclude = {
  slots: true,
  steps: { orderBy: { order: "asc" } },
} satisfies Prisma.ClockWheelInclude;

type WheelWithIncludes = Prisma.ClockWheelGetPayload<{ include: typeof wheelInclude }>;

function toClockWheelDTO(wheel: WheelWithIncludes): ClockWheelDTO {
  return {
    id: wheel.id,
    name: wheel.name,
    isActive: wheel.isActive,
    isDefault: wheel.isDefault,
    slots: wheel.slots.map((slot) => ({
      id: slot.id,
      weekdays: slot.weekdays,
      startTime: formatTimeOfDay(slot.startTime),
      endTime: formatTimeOfDay(slot.endTime),
    })),
    steps: wheel.steps.map((step) => ({
      id: step.id,
      order: step.order,
      mediaKind: step.mediaKind,
      selectionStrategy: step.selectionStrategy,
      categoryId: step.categoryId,
      tag: step.tag,
    })),
  };
}

// Default wheel first, then newest-first -- matches the "default fills the gaps" mental
// model the week-grid/list page present.
clockWheelsRoutes.get("/", async (_req, res) => {
  const wheels = await prisma.clockWheel.findMany({
    include: wheelInclude,
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
  res.json(wheels.map((wheel) => ClockWheelSchema.parse(toClockWheelDTO(wheel))));
});

clockWheelsRoutes.get("/:id", async (req, res) => {
  const wheel = await prisma.clockWheel.findUnique({ where: { id: req.params.id }, include: wheelInclude });
  if (!wheel) {
    res.status(404).json({ error: "clock wheel not found" });
    return;
  }
  res.json(ClockWheelSchema.parse(toClockWheelDTO(wheel)));
});

interface UpsertValidationInput {
  isActive: boolean;
  slots: { weekdays: number[]; startTime: string; endTime: string }[];
  steps: { categoryId: string | null }[];
}

/** Validates every step's categoryId exists (when set) and that no two active,
 * non-default wheels' slots overlap on a shared weekday -- sends the response directly
 * and returns false if invalid, same convention as schedule.routes.ts's validateItems. */
async function validateUpsert(data: UpsertValidationInput, excludeWheelId: string | null, res: Response): Promise<boolean> {
  for (const step of data.steps) {
    if (!step.categoryId) continue;
    const category = await prisma.category.findUnique({ where: { id: step.categoryId } });
    if (!category) {
      res.status(404).json({ error: `category not found: ${step.categoryId}` });
      return false;
    }
  }

  if (!data.isActive || data.slots.length === 0) return true;

  const otherWheels = await prisma.clockWheel.findMany({
    where: { isActive: true, isDefault: false, id: excludeWheelId ? { not: excludeWheelId } : undefined },
    include: { slots: true },
  });
  const candidateSlots = data.slots.map((slot) => ({
    weekdays: slot.weekdays,
    startTime: parseTimeOfDay(slot.startTime),
    endTime: parseTimeOfDay(slot.endTime),
  }));

  for (const other of otherWheels) {
    for (const otherSlot of other.slots) {
      for (const candidate of candidateSlots) {
        if (slotsOverlap(candidate, otherSlot)) {
          res.status(400).json({ error: `slot overlaps with an existing active clock wheel: "${other.name}"` });
          return false;
        }
      }
    }
  }
  return true;
}

clockWheelsRoutes.post("/", async (req, res) => {
  const parsed = UpsertClockWheelRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request", details: parsed.error.issues });
    return;
  }

  const { name, isActive, slots, steps } = parsed.data;
  if (!(await validateUpsert({ isActive, slots, steps }, null, res))) return;

  const wheel = await prisma.clockWheel.create({
    data: {
      name,
      isActive,
      slots: {
        create: slots.map((slot) => ({
          weekdays: slot.weekdays,
          startTime: parseTimeOfDay(slot.startTime),
          endTime: parseTimeOfDay(slot.endTime),
        })),
      },
      // order is always derived from array position, same convention as
      // ScheduleRuleItem in schedule.routes.ts -- any client-submitted order is ignored.
      steps: {
        create: steps.map((step, index) => ({
          order: index,
          mediaKind: step.mediaKind,
          selectionStrategy: step.selectionStrategy,
          categoryId: step.categoryId,
          tag: step.tag,
        })),
      },
    },
    include: wheelInclude,
  });

  res.status(201).json(ClockWheelSchema.parse(toClockWheelDTO(wheel)));
});

clockWheelsRoutes.patch("/:id", async (req, res) => {
  const existing = await prisma.clockWheel.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: "clock wheel not found" });
    return;
  }

  const parsed = UpsertClockWheelRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request", details: parsed.error.issues });
    return;
  }

  const { name, isActive, steps } = parsed.data;
  // The default wheel's own slots are always empty/ignored -- it's the fallback for
  // whatever time no other active wheel matches, so it never has its own day/time window.
  const slots = existing.isDefault ? [] : parsed.data.slots;

  if (!(await validateUpsert({ isActive, slots, steps }, existing.id, res))) return;

  const wheel = await prisma.$transaction(async (tx) => {
    await tx.clockWheelSlot.deleteMany({ where: { clockWheelId: existing.id } });
    await tx.clockWheelStep.deleteMany({ where: { clockWheelId: existing.id } });
    return tx.clockWheel.update({
      where: { id: existing.id },
      data: {
        name,
        isActive,
        slots: {
          create: slots.map((slot) => ({
            weekdays: slot.weekdays,
            startTime: parseTimeOfDay(slot.startTime),
            endTime: parseTimeOfDay(slot.endTime),
          })),
        },
        steps: {
          create: steps.map((step, index) => ({
            order: index,
            mediaKind: step.mediaKind,
            selectionStrategy: step.selectionStrategy,
            categoryId: step.categoryId,
            tag: step.tag,
          })),
        },
      },
      include: wheelInclude,
    });
  });

  res.json(ClockWheelSchema.parse(toClockWheelDTO(wheel)));
});

clockWheelsRoutes.delete("/:id", async (req, res) => {
  const existing = await prisma.clockWheel.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: "clock wheel not found" });
    return;
  }
  if (existing.isDefault) {
    res.status(400).json({ error: "the default clock wheel cannot be deleted" });
    return;
  }

  await prisma.clockWheel.delete({ where: { id: existing.id } });
  res.status(204).send();
});
