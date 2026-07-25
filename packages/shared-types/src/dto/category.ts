import { z } from "zod";

export const CategorySchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type CategoryDTO = z.infer<typeof CategorySchema>;

/** The one category every song/jingle is always attached to, and the only
 * category an Ad may ever carry -- see ads.routes.ts. */
export const ALL_CATEGORY_NAME = "ALL";

export const CreateCategoryRequestSchema = z.object({
  name: z.string().min(1).max(64),
});
export type CreateCategoryRequestDTO = z.infer<typeof CreateCategoryRequestSchema>;
