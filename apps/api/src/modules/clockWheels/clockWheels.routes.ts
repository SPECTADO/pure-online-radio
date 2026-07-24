import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { notImplemented } from "../../lib/notImplemented.js";

export const clockWheelsRoutes = Router();

clockWheelsRoutes.use(requireAuth, requireRole("MANAGER", "ADMIN"));

clockWheelsRoutes.get("/", notImplemented("list ClockWheel rows with slots + steps (ClockWheelDTO[])"));
clockWheelsRoutes.get("/:id", notImplemented("fetch a single ClockWheel with slots + steps"));
clockWheelsRoutes.post(
  "/",
  notImplemented("validate UpsertClockWheelRequestDTO, create ClockWheel + slots + steps"),
);
clockWheelsRoutes.patch("/:id", notImplemented("update a ClockWheel's slots/steps"));
clockWheelsRoutes.delete("/:id", notImplemented("delete a ClockWheel (cascades its slots/steps)"));
