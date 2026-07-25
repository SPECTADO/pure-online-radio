import { prisma } from "@spectado/database";
import { ALL_CATEGORY_NAME } from "@spectado/shared-types";

/** The seed script already creates "ALL" (see packages/database/prisma/seed.ts),
 * but every write path that depends on it upserts defensively rather than
 * assuming a particular deployment was seeded. */
export async function ensureAllCategoryId(): Promise<string> {
  const category = await prisma.category.upsert({
    where: { name: ALL_CATEGORY_NAME },
    update: {},
    create: { name: ALL_CATEGORY_NAME },
  });
  return category.id;
}
