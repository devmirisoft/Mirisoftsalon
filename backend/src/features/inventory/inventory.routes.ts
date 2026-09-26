import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/rbac.middleware.js";
import { validateUuidParam } from "../../middlewares/uuid.middleware.js";
import { INVENTORY_VIEW_ROLES } from "../products/inventory-access.js";
import {
  getProductInventory,
  getUsagePlan,
  postOpenContainers,
  postReconcileContainer,
  postTransfer,
} from "./inventory.controller.js";

const router = Router();
router.param("productId", validateUuidParam("productId"));
router.param("appointmentId", validateUuidParam("appointmentId"));
router.param("containerId", validateUuidParam("containerId"));
router.use(authenticate);

// Moving stock onto a shelf and opening a pack are everyday counter and
// service-floor work; branch-locked roles are confined to their own branch in
// the controller. Correcting what a container holds is an inventory
// adjustment, which stays with the roles that may adjust stock.
router.get("/products/:productId", requireRole(...INVENTORY_VIEW_ROLES), getProductInventory);
router.get("/usage-plan/:appointmentId", requireRole(...INVENTORY_VIEW_ROLES), getUsagePlan);
router.post("/transfers", requireRole(...INVENTORY_VIEW_ROLES), postTransfer);
router.post("/containers/open", requireRole(...INVENTORY_VIEW_ROLES), postOpenContainers);
router.post(
  "/containers/:containerId/reconcile",
  requireRole("SUPER_ADMIN", "SALON_ADMIN"),
  postReconcileContainer
);

export default router;
