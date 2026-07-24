import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "@spectado/database";
import { AuthUserSchema, type AuthUserDTO } from "@spectado/shared-types";
import { config } from "../../config/env.js";

export class InvalidCredentialsError extends Error {}

export async function authenticate(username: string, password: string): Promise<AuthUserDTO> {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.isActive) {
    throw new InvalidCredentialsError("invalid username or password");
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    throw new InvalidCredentialsError("invalid username or password");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return { id: user.id, username: user.username, role: user.role };
}

export async function getAuthUser(userId: string): Promise<AuthUserDTO | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) {
    return null;
  }
  return { id: user.id, username: user.username, role: user.role };
}

export function signAccessToken(user: AuthUserDTO): string {
  // expiresIn as a number of seconds sidesteps @types/jsonwebtoken's `StringValue`
  // template-literal type, which a plain `string` from env can't satisfy statically.
  return jwt.sign(user, config.jwt.secret, { expiresIn: Math.floor(ttlToMs(config.jwt.accessTtl) / 1000) });
}

export function signRefreshToken(user: AuthUserDTO): string {
  return jwt.sign(user, config.jwt.secret, { expiresIn: Math.floor(ttlToMs(config.jwt.refreshTtl) / 1000) });
}

export function verifyRefreshToken(token: string): AuthUserDTO {
  const decoded = jwt.verify(token, config.jwt.secret);
  return AuthUserSchema.parse(decoded);
}

/** Converts a jsonwebtoken-style TTL string ("15m", "7d", ...) to milliseconds for cookie maxAge. */
export function ttlToMs(ttl: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)$/.exec(ttl.trim());
  if (!match) {
    const n = Number(ttl);
    return Number.isFinite(n) ? n : 15 * 60_000;
  }
  const value = Number(match[1]);
  const unit = match[2] as "ms" | "s" | "m" | "h" | "d";
  const multipliers: Record<typeof unit, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * multipliers[unit];
}
