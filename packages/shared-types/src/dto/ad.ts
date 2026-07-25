import { z } from "zod";
import { CategorySchema } from "./category.js";

export const AdSchema = z.object({
  id: z.string(),
  title: z.string(),
  durationMs: z.number().int().positive(),
  activeFrom: z.string().datetime(),
  activeUntil: z.string().datetime(),
  /** Always exactly the "ALL" category today -- see ads.routes.ts. Exposed as
   * an array (not a single field) to stay shape-compatible with Song/Jingle
   * if ad categorization is ever opened up beyond "ALL". */
  categories: z.array(CategorySchema),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
});
export type AdDTO = z.infer<typeof AdSchema>;

/** Parsed text fields of a multipart `POST /library/ads` request -- the audio
 * file itself is handled separately by multer. */
export const CreateAdRequestSchema = z
  .object({
    title: z.string().min(1).optional(),
    activeFrom: z.string().datetime(),
    activeUntil: z.string().datetime(),
  })
  .refine((data) => new Date(data.activeUntil) > new Date(data.activeFrom), {
    message: "activeUntil must be after activeFrom",
    path: ["activeUntil"],
  });
export type CreateAdRequestDTO = z.infer<typeof CreateAdRequestSchema>;

export const UpdateAdRequestSchema = z
  .object({
    title: z.string().min(1).optional(),
    activeFrom: z.string().datetime().optional(),
    activeUntil: z.string().datetime().optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (data) =>
      !data.activeFrom || !data.activeUntil || new Date(data.activeUntil) > new Date(data.activeFrom),
    { message: "activeUntil must be after activeFrom", path: ["activeUntil"] },
  );
export type UpdateAdRequestDTO = z.infer<typeof UpdateAdRequestSchema>;
