import type { NextFunction, Request, Response } from "express";
import { logger } from "../logger.js";

/**
 * Last-resort Express error handler -- must be mounted after all routes.
 * Keeps the arity of 4 params (err, req, res, next) so Express recognizes it
 * as error-handling middleware, even though `next` itself is unused.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  logger.error({ err, path: req.path, method: req.method }, "unhandled request error");

  if (res.headersSent) {
    return;
  }

  res.status(500).json({ error: "internal server error" });
}
