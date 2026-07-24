import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { AuthUserSchema, type AuthUserDTO, type Role } from "@spectado/shared-types";
import { config } from "../config/env.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUserDTO;
    }
  }
}

/** Verifies the JWT in the httpOnly `access_token` cookie and attaches `req.user`. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.access_token as string | undefined;
  if (!token) {
    res.status(401).json({ error: "missing access token" });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = AuthUserSchema.parse(decoded);
    next();
  } catch {
    res.status(401).json({ error: "invalid or expired access token" });
  }
}

/** Must run after requireAuth. Rejects unless req.user.role is one of `roles`. */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
}
