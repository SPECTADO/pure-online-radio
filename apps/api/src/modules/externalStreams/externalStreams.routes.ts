import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { notImplemented } from "../../lib/notImplemented.js";

export const externalStreamsRoutes = Router();

externalStreamsRoutes.use(requireAuth, requireRole("MANAGER", "ADMIN"));

externalStreamsRoutes.get("/", notImplemented("list ExternalStream rows (ExternalStreamDTO[])"));
externalStreamsRoutes.get("/:id", notImplemented("fetch a single ExternalStream"));
externalStreamsRoutes.post(
  "/",
  notImplemented(
    "validate CreateExternalStreamRequestDTO and create an ExternalStream row; the actual relay is " +
      "scheduled closer to startAt via radio.encoder.cmd.relay.start",
  ),
);
externalStreamsRoutes.patch("/:id", notImplemented("update/reschedule an ExternalStream"));
externalStreamsRoutes.delete("/:id", notImplemented("cancel an ExternalStream"));
