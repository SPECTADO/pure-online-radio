import type { NextFunction, Request, Response } from "express";
import { config } from "../config/env.js";

/** Guards /internal/* routes: the caller (encoder) must present the shared ENCODER_CALLBACK_TOKEN. */
export function internalOnly(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const expected = `Bearer ${config.encoderCallbackToken}`;

  if (!header || header !== expected) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  next();
}
