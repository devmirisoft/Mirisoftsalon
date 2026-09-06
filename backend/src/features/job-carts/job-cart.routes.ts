import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/rbac.middleware.js";
import { validateUuidParam } from "../../middlewares/uuid.middleware.js";
import {
  deleteJobCartItem,
  deleteJobCartPackageRedemption,
  getJobCartById,
  getJobCartReferenceData,
  getJobCartPackageRedemptionList,
  getJobCartCustomerSummaryController,
  getJobCarts,
  postCancelJobCart,
  postConfirmJobCart,
  postJobCart,
  postJobCartItem,
  patchJobCartItem,
  postJobCartPackageRedemption,
  putJobCart,
} from "./job-cart.controller.js";

const router = Router();
const allowedRoles = [
  "SUPER_ADMIN",
  "SALON_ADMIN",
  "BRANCH_MANAGER",
  "RECEPTIONIST",
] as const;

router.param("id", validateUuidParam("id"));
router.param("itemId", validateUuidParam("itemId"));
router.param("usageId", validateUuidParam("usageId"));
router.use(authenticate);
router.use(requireRole(...allowedRoles));

router.get("/", getJobCarts);
router.post("/", postJobCart);
router.get("/references", getJobCartReferenceData);
router.get("/customer-summary", getJobCartCustomerSummaryController);
router.get("/:id", getJobCartById);
router.put("/:id", putJobCart);
router.post("/:id/items", postJobCartItem);
router.patch("/:id/items/:itemId", patchJobCartItem);
router.delete("/:id/items/:itemId", deleteJobCartItem);
router.get("/:id/package-redemptions", getJobCartPackageRedemptionList);
router.post("/:id/package-redemptions", postJobCartPackageRedemption);
router.delete(
  "/:id/package-redemptions/:usageId",
  deleteJobCartPackageRedemption
);
router.post("/:id/confirm", postConfirmJobCart);
router.post("/:id/cancel", postCancelJobCart);

export default router;
