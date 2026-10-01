import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/rbac.middleware.js";
import { validateUuidParam } from "../../middlewares/uuid.middleware.js";
import {
  getAvailabilityRuleById,
  getAvailabilityRules,
  getRoster,
  getSlots,
  getStatuses,
  getTimeBlockById,
  getTimeBlocks,
  patchAvailabilityRuleStatus,
  postAvailabilityRule,
  postTimeBlock,
  putAvailabilityRule,
  putTimeBlock,
  removeAvailabilityRule,
  removeTimeBlock,
} from "./staffAvailability.controller.js";

const viewRoles = [
  "SUPER_ADMIN",
  "SALON_ADMIN",
  "BRANCH_MANAGER",
  "RECEPTIONIST",
  "STAFF",
];
const manageRoles = ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER"];

export const staffAvailabilityRouter = Router();
staffAvailabilityRouter.param("id", validateUuidParam("id"));
staffAvailabilityRouter.use(authenticate);
staffAvailabilityRouter.get(
  "/slots",
  requireRole(...viewRoles),
  getSlots
);
staffAvailabilityRouter.get(
  "/status",
  requireRole(...viewRoles),
  getStatuses
);
staffAvailabilityRouter.get(
  "/",
  requireRole(...viewRoles),
  getAvailabilityRules
);
staffAvailabilityRouter.post(
  "/",
  requireRole(...manageRoles),
  postAvailabilityRule
);
staffAvailabilityRouter.get(
  "/:id",
  requireRole(...viewRoles),
  getAvailabilityRuleById
);
staffAvailabilityRouter.put(
  "/:id",
  requireRole(...manageRoles),
  putAvailabilityRule
);
staffAvailabilityRouter.patch(
  "/:id/status",
  requireRole(...manageRoles),
  patchAvailabilityRuleStatus
);
staffAvailabilityRouter.delete(
  "/:id",
  requireRole(...manageRoles),
  removeAvailabilityRule
);

export const staffTimeBlockRouter = Router();
staffTimeBlockRouter.param("id", validateUuidParam("id"));
staffTimeBlockRouter.use(authenticate);
staffTimeBlockRouter.get("/", requireRole(...viewRoles), getTimeBlocks);
staffTimeBlockRouter.post("/", requireRole(...manageRoles), postTimeBlock);
staffTimeBlockRouter.get(
  "/:id",
  requireRole(...viewRoles),
  getTimeBlockById
);
staffTimeBlockRouter.put(
  "/:id",
  requireRole(...manageRoles),
  putTimeBlock
);
staffTimeBlockRouter.delete(
  "/:id",
  requireRole(...manageRoles),
  removeTimeBlock
);

export const staffRosterRouter = Router();
staffRosterRouter.use(authenticate);
staffRosterRouter.get("/", requireRole(...viewRoles), getRoster);
