import type { Request, Response } from "express";

/**
 * Registers a real, routed Express handler that responds 501 with a
 * consistent `{error, todo}` JSON shape -- used for scaffold routes whose
 * business logic isn't built yet. Never use this for a route that should
 * 404; the route itself is real and reachable, only the implementation is
 * deferred.
 */
export function notImplemented(todo: string) {
  return (_req: Request, res: Response): void => {
    res.status(501).json({ error: "not implemented", todo });
  };
}
