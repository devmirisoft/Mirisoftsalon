import { Router } from "express";
import { createInvoiceFromAppointment, getInvoices, getInvoiceById, cancelInvoice, updateInvoice, redeemLoyaltyPoints, applyInvoiceCoupon, removeInvoiceCoupon, issueInvoice, } from "./invoice.controller.js";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/rbac.middleware.js";
import { validateUuidParam } from "../../middlewares/uuid.middleware.js";
const router = Router();
router.param("id", validateUuidParam("id"));
router.param("appointmentId", validateUuidParam("appointmentId"));
router.use(authenticate);
router.post("/from-appointment/:appointmentId", 
// The front desk bills the appointment it just completed, the same way it
// confirms a job cart.
requireRole("SUPER_ADMIN", "SALON_ADMIN", "RECEPTIONIST", "STAFF"), createInvoiceFromAppointment);
router.get("/", requireRole("SUPER_ADMIN", "SALON_ADMIN", "RECEPTIONIST", "STAFF"), getInvoices);
router.put("/:id", requireRole("SUPER_ADMIN", "SALON_ADMIN"), updateInvoice);
router.patch("/:id/cancel", requireRole("SUPER_ADMIN", "SALON_ADMIN"), cancelInvoice);
router.post("/:id/redeem-loyalty", requireRole("SUPER_ADMIN", "SALON_ADMIN", "RECEPTIONIST"), redeemLoyaltyPoints);
router.post("/:id/apply-coupon", requireRole("SUPER_ADMIN", "SALON_ADMIN", "RECEPTIONIST"), applyInvoiceCoupon);
router.post("/:id/remove-coupon", requireRole("SUPER_ADMIN", "SALON_ADMIN", "RECEPTIONIST"), removeInvoiceCoupon);
router.patch("/:id/issue", 
// The front desk issues the draft it parked when the customer comes back to
// pay, so it can bill and issue with the same hands.
requireRole("SUPER_ADMIN", "SALON_ADMIN", "RECEPTIONIST"), issueInvoice);
router.get("/:id", requireRole("SUPER_ADMIN", "SALON_ADMIN", "RECEPTIONIST", "STAFF"), getInvoiceById);
export default router;
