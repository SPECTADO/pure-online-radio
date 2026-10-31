import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config/env.js";

/** Guards /internal/* routes: the caller (encoder) must present the shared ENCODER_CALLBACK_TOKEN.
 * Constant-time compare (length checked first -- timingSafeEqual throws on a mismatch). The
 * webserver also refuses /api/internal/* outright, so in practice only the compose network
 * reaches this (see apps/webserver/Caddyfile). */
export function internalOnly(req: Request, res: Response, next: NextFunction): void {
  const header = Buffer.from(req.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${config.encoderCallbackToken}`);

  if (header.length !== expected.length || !timingSafeEqual(header, expected)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  next();
}
