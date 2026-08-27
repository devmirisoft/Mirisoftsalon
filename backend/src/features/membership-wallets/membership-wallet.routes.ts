import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/rbac.middleware.js";
import { validateUuidParam } from "../../middlewares/uuid.middleware.js";
import {
  getCustomerWallet,
  getWallet,
  getWalletTransactions,
  postWalletAdjustment,
  postWalletInvoicePayment,
  postWalletTopUp,
} from "./membership-wallet.controller.js";

const router = Router();
router.param("id", validateUuidParam("id"));
router.use(authenticate);

router.get(
  "/transactions",
  requireRole("SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST"),
  getWalletTransactions
);

router.param("customerId", validateUuidParam("customerId"));

// Spendable balance for a customer, used by the billing screen.
router.get(
  "/customer/:customerId",
  requireRole("SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST"),
  getCustomerWallet
);

router.post(
  "/pay",
  requireRole("SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST"),
  postWalletInvoicePayment
);

router.get(
  "/:id",
  requireRole("SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST"),
  getWallet
);

router.post(
  "/:id/topup",
  requireRole("SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST"),
  postWalletTopUp
);

// Manual corrections bypass the normal purchase/spend flow, so they stay
// with administrators only.
router.post(
  "/:id/adjust",
  requireRole("SUPER_ADMIN", "SALON_ADMIN"),
  postWalletAdjustment
);

export default router;
