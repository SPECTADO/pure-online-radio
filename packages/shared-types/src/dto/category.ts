import { z } from "zod";

export const CategorySchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type CategoryDTO = z.infer<typeof CategorySchema>;
