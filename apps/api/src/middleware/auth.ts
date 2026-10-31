import type { NextFunction, Request, Response } from "express";
import type { AuthUserDTO, Role } from "@spectado/shared-types";
import { verifyToken } from "../modules/auth/auth.service.js";

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
    req.user = verifyToken(token, "access");
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
