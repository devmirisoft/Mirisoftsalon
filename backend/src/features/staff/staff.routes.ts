import { Router } from "express";
import {
  createStaff,
  getStaff,
  getStaffById,
  updateStaff,
  updateStaffStatus,
  deleteStaff,
} from "./staff.controller.js";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/rbac.middleware.js";

import { validateUuidParam } from "../../middlewares/uuid.middleware.js";

const router = Router();
router.param("id", validateUuidParam("id"));

router.use(authenticate);

router.post("/", requireRole("SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER"), createStaff);

router.get("/", requireRole("SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST"), getStaff);

router.get("/:id", requireRole("SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST"), getStaffById);

router.put("/:id", requireRole("SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER"), updateStaff);

router.patch(
  "/:id/status",
  requireRole("SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER"),
  updateStaffStatus
);

router.delete("/:id", requireRole("SUPER_ADMIN", "SALON_ADMIN"), deleteStaff);

export default router;
