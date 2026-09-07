import { type Request, type Response } from "express";
import { prisma } from "../../config/prisma.js";
import {
  branchScope,
  cleanText,
  getSalonId,
  sendInventoryError,
  transactionError,
  validateBranch,
  writableBranch,
} from "../products/inventory-access.js";
import { VendorPaymentModel } from "./vendor-payment.model.js";

const PAYMENT_METHODS = [
  "CASH",
  "UPI",
  "GPAY",
  "PAYTM",
  "PHONEPE",
  "CARD",
  "BANK_TRANSFER",
  "CHEQUE",
  "OTHER",
] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const idParam = (req: Request) =>
  typeof req.params.id === "string" ? req.params.id : "";

const listWhere = (req: Request) => ({
  ...(req.user?.role === "SUPER_ADMIN"
    ? typeof req.query.salonId === "string"
      ? { salonId: req.query.salonId }
      : {}
    : { salonId: req.user?.salonId || "__missing__" }),
  ...(typeof req.query.vendorId === "string"
    ? { vendorId: req.query.vendorId }
    : {}),
  ...(typeof req.query.purchaseId === "string"
    ? { purchaseId: req.query.purchaseId }
    : {}),
  ...(typeof req.query.branchId === "string"
    ? { branchId: req.query.branchId }
    : {}),
  ...branchScope(req),
});

export const createVendorPayment = async (req: Request, res: Response) => {
  try {
    const salonId = getSalonId(req, req.body.salonId);
    const vendorId =
      typeof req.body.vendorId === "string" ? req.body.vendorId : "";
    const purchaseId =
      typeof req.body.purchaseId === "string" && req.body.purchaseId
        ? req.body.purchaseId
        : undefined;
    const branchId = writableBranch(req, req.body.branchId);
    const amount = Number(req.body.amount);
    const method = req.body.paymentMethod as PaymentMethod;
    if (!salonId || !vendorId || !PAYMENT_METHODS.includes(method)) {
      return res.status(400).json({
        success: false,
        message: "Salon, vendor and a valid payment method are required",
      });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Payment amount must be greater than zero",
      });
    }
    if (!(await validateBranch(salonId, branchId))) {
      return res.status(400).json({
        success: false,
        message: "Invalid branch for this salon",
      });
    }
    const paymentDate = req.body.paymentDate
      ? new Date(req.body.paymentDate)
      : undefined;
    if (paymentDate && Number.isNaN(paymentDate.getTime())) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid payment date" });
    }

    const paymentId = await prisma.$transaction(async (tx) => {
      const vendor = await tx.vendor.findFirst({
        where: { id: vendorId, salonId },
        select: { id: true, status: true },
      });
      if (!vendor) throw transactionError("Vendor not found", 404);
      if (!vendor.status) throw transactionError("Vendor is inactive");

      const purchase = purchaseId
        ? await tx.productPurchase.findFirst({
            where: { id: purchaseId, salonId, vendorId },
            select: {
              id: true,
              branchId: true,
              paidAmount: true,
              balanceAmount: true,
            },
          })
        : null;
      if (purchaseId && !purchase) {
        throw transactionError(
          "Purchase was not found for this vendor and salon",
          404
        );
      }
      if (purchase && branchId && purchase.branchId !== branchId) {
        throw transactionError("Payment branch must match the purchase branch");
      }
      if (purchase && amount > Number(purchase.balanceAmount)) {
        throw transactionError("Payment amount cannot exceed purchase balance");
      }

      const referenceNo = cleanText(req.body.referenceNo);
      const note = cleanText(req.body.note);
      const paymentBranchId = branchId ?? purchase?.branchId ?? undefined;
      const payment = await tx.vendorPayment.create({
        data: {
          salonId,
          vendorId,
          ...(paymentBranchId ? { branchId: paymentBranchId } : {}),
          ...(purchaseId ? { purchaseId } : {}),
          amount,
          paymentMethod: method,
          ...(paymentDate ? { paymentDate } : {}),
          ...(referenceNo ? { referenceNo } : {}),
          ...(note ? { note } : {}),
          ...(req.user?.userId ? { createdById: req.user.userId } : {}),
        },
        select: { id: true },
      });

      if (purchase) {
        const changed = await tx.productPurchase.updateMany({
          where: { id: purchase.id, balanceAmount: { gte: amount } },
          data: {
            paidAmount: { increment: amount },
            balanceAmount: { decrement: amount },
          },
        });
        if (changed.count !== 1) {
          throw transactionError("Purchase balance changed; retry the payment", 409);
        }
        const updatedPurchase = await tx.productPurchase.findUniqueOrThrow({
          where: { id: purchase.id },
          select: { balanceAmount: true, paidAmount: true },
        });
        await tx.productPurchase.update({
          where: { id: purchase.id },
          data: {
            paymentStatus:
              Number(updatedPurchase.balanceAmount) <= 0
                ? "PAID"
                : Number(updatedPurchase.paidAmount) > 0
                  ? "PARTIALLY_PAID"
                  : "UNPAID",
          },
        });
      }
      return payment.id;
    });

    const data = await VendorPaymentModel.find({ id: paymentId, salonId });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

export const getVendorPayments = async (req: Request, res: Response) => {
  try {
    const data = await VendorPaymentModel.list(listWhere(req));
    return res.json({ success: true, data });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

export const getVendorPayment = async (req: Request, res: Response) => {
  try {
    const data = await VendorPaymentModel.find({
      id: idParam(req),
      ...listWhere(req),
    });
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Vendor payment not found" });
    }
    return res.json({ success: true, data });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};
