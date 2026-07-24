import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { notImplemented } from "../../lib/notImplemented.js";

export const scheduleRoutes = Router();

scheduleRoutes.use(requireAuth, requireRole("MANAGER", "ADMIN"));

scheduleRoutes.get("/", notImplemented("list ScheduledItem rows (upcoming one-off queue entries)"));
scheduleRoutes.get("/:id", notImplemented("fetch a single ScheduledItem"));
scheduleRoutes.post(
  "/",
  notImplemented("validate + create a ScheduledItem (song/jingle one-off at a given time)"),
);
scheduleRoutes.patch("/:id", notImplemented("update a pending ScheduledItem"));
scheduleRoutes.delete("/:id", notImplemented("cancel a pending ScheduledItem"));
