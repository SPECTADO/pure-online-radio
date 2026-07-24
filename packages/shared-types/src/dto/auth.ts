import { z } from "zod";
import { RoleSchema } from "./common.js";

export const LoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginRequestDTO = z.infer<typeof LoginRequestSchema>;

export const AuthUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  role: RoleSchema,
});
export type AuthUserDTO = z.infer<typeof AuthUserSchema>;

export const NatsCredentialsSchema = z.object({
  url: z.string(),
  user: z.string(),
  password: z.string(),
  expiresAt: z.string().datetime(),
  allowedSubjects: z.array(z.string()),
});
export type NatsCredentialsDTO = z.infer<typeof NatsCredentialsSchema>;
