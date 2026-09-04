import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/rbac.middleware.js";
import {
  getExpenseReport,
  getInventoryReport,
  getStaffPerformance,
} from "./report.controller.js";
import { getSalonReport } from "./salon-report.controller.js";
import { exportReport } from "./report-export.controller.js";

const router = Router();
router.use(authenticate);
router.get(
  "/inventory",
  requireRole(
    "SUPER_ADMIN",
    "SALON_ADMIN",
    "BRANCH_MANAGER",
    "RECEPTIONIST",
    "STAFF"
  ),
  getInventoryReport
);
router.get(
  "/staff-performance",
  requireRole("SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER"),
  getStaffPerformance
);
router.get(
  "/expenses",
  requireRole("SUPER_ADMIN", "SALON_ADMIN"),
  getExpenseReport
);
router.get(
  "/salon-report",
  requireRole("SUPER_ADMIN", "SALON_ADMIN"),
  getSalonReport
);
router.get(
  "/:reportType/export",
  requireRole(
    "SUPER_ADMIN",
    "SALON_ADMIN",
    "BRANCH_MANAGER",
    "RECEPTIONIST",
    "STAFF"
  ),
  exportReport
);

export default router;
