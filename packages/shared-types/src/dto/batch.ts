import { z } from "zod";

export const BatchDeleteRequestSchema = z.object({
  ids: z.array(z.string()).min(1),
});
export type BatchDeleteRequestDTO = z.infer<typeof BatchDeleteRequestSchema>;

export const BatchCategoryActionSchema = z.enum(["add", "remove"]);
export type BatchCategoryAction = z.infer<typeof BatchCategoryActionSchema>;

export const BatchCategoryRequestSchema = z.object({
  ids: z.array(z.string()).min(1),
  categoryId: z.string(),
  action: BatchCategoryActionSchema,
});
export type BatchCategoryRequestDTO = z.infer<typeof BatchCategoryRequestSchema>;

/** Shared response shape for any batch mutation -- how many rows it actually touched. */
export const BatchResultSchema = z.object({
  count: z.number().int().nonnegative(),
});
export type BatchResultDTO = z.infer<typeof BatchResultSchema>;
