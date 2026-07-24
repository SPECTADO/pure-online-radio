import { z } from "zod";
import { ExternalStreamStatusSchema } from "./common.js";

export const ExternalStreamSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().url(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  status: ExternalStreamStatusSchema,
});
export type ExternalStreamDTO = z.infer<typeof ExternalStreamSchema>;

export const CreateExternalStreamRequestSchema = z
  .object({
    name: z.string().min(1),
    url: z.string().url(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
  })
  .refine((v) => new Date(v.endAt) > new Date(v.startAt), {
    message: "endAt must be after startAt",
    path: ["endAt"],
  });
export type CreateExternalStreamRequestDTO = z.infer<typeof CreateExternalStreamRequestSchema>;
