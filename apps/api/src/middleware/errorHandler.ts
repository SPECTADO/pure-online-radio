import type { NextFunction, Request, Response } from "express";
import { MulterError } from "multer";
import { logger } from "../logger.js";

/**
 * Last-resort Express error handler -- must be mounted after all routes.
 * Keeps the arity of 4 params (err, req, res, next) so Express recognizes it
 * as error-handling middleware, even though `next` itself is unused.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    return;
  }

  // Upload validation failures (file too large, wrong field, wrong mime type
  // from the library upload routes' fileFilter) are a client mistake, not a
  // server fault -- respond 400 instead of the generic 500 below.
  if (err instanceof MulterError || (err instanceof Error && /must be an (audio|image) file/.test(err.message))) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  logger.error({ err, path: req.path, method: req.method }, "unhandled request error");
  res.status(500).json({ error: "internal server error" });
}
