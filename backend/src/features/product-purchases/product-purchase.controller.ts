import { type Request, type Response } from "express";
import { prisma } from "../../config/prisma.js";
import {
  exactBranchScope,
  writableBranch,
  getSalonId,
  sendInventoryError,
  validateBranch,
} from "../products/inventory-access.js";
import { ProductPurchaseModel } from "./product-purchase.model.js";
import { createReceivedProductPurchase } from "./product-purchase.service.js";
import { PAYMENT_METHODS, type PaymentMethod } from "../vendor-payments/vendor-payment.controller.js";

type PurchaseItem = { productId: string; quantity: number; unitCost: number };
const idParam = (req: Request) => typeof req.params.id === "string" ? req.params.id : "";
const listWhere = (req: Request) => ({
  ...(req.user?.role === "SUPER_ADMIN"
    ? typeof req.query.salonId === "string"
      ? { salonId: req.query.salonId }
      : {}
    : { salonId: req.user?.salonId || "__missing__" }),
  ...exactBranchScope(req),
  ...(typeof req.query.vendorId === "string" ? { vendorId: req.query.vendorId } : {}),
});

export const createProductPurchase = async (req: Request, res: Response) => {
  try {
    const salonId = getSalonId(req, req.body.salonId);
    const branchId = writableBranch(req, req.body.branchId);
    const vendorId = typeof req.body.vendorId === "string" && req.body.vendorId ? req.body.vendorId : undefined;
    if (!salonId) return res.status(400).json({ success: false, message: "Salon is required" });
    if (!(await validateBranch(salonId, branchId))) {
      return res.status(400).json({ success: false, message: "Invalid branch for this salon" });
    }
    const purchaseDate = req.body.purchaseDate ? new Date(req.body.purchaseDate) : undefined;
    if (purchaseDate && Number.isNaN(purchaseDate.getTime())) {
      return res.status(400).json({ success: false, message: "Invalid purchase date" });
    }
    if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
      return res.status(400).json({ success: false, message: "At least one purchase item is required" });
    }
    const items: PurchaseItem[] = req.body.items.map((item: Record<string, unknown>) => ({
      productId: typeof item.productId === "string" ? item.productId : "",
      quantity: Number(item.quantity),
      unitCost: Number(item.unitCost),
    }));
    if (items.some((item) => !item.productId || !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unitCost) || item.unitCost < 0)) {
      return res.status(400).json({ success: false, message: "Purchase quantities must be positive and unit costs non-negative" });
    }
    if (new Set(items.map((item) => item.productId)).size !== items.length) {
      return res.status(400).json({ success: false, message: "Each product may appear only once per purchase" });
    }

    const taxAmount = Number(req.body.taxAmount ?? 0);
    const paidAmount = Number(req.body.paidAmount ?? 0);
    if (!Number.isFinite(taxAmount) || taxAmount < 0 || !Number.isFinite(paidAmount) || paidAmount < 0) {
      return res.status(400).json({ success: false, message: "Tax and paid amount must be non-negative numbers" });
    }
    const paymentMethod = req.body.paymentMethod as PaymentMethod;
    if (paidAmount > 0 && !PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(400).json({ success: false, message: "A valid payment method is required when recording a payment" });
    }

    const data = await prisma.$transaction((tx) =>
      createReceivedProductPurchase({
        tx,
        salonId,
        ...(branchId ? { branchId } : {}),
        ...(vendorId ? { vendorId } : {}),
        ...(typeof req.body.supplierName === "string" &&
        req.body.supplierName.trim()
          ? {
              supplierName: req.body.supplierName.trim(),
            }
          : {}),
        ...(typeof req.body.supplierPhone === "string" &&
        req.body.supplierPhone.trim()
          ? {
              supplierPhone: req.body.supplierPhone.trim(),
            }
          : {}),
        ...(typeof req.body.invoiceNo === "string" &&
        req.body.invoiceNo.trim()
          ? {
              invoiceNo: req.body.invoiceNo.trim(),
            }
          : {}),
        ...(purchaseDate ? { purchaseDate } : {}),
        ...(typeof req.body.note === "string" && req.body.note.trim()
          ? {
              note: req.body.note.trim(),
            }
          : {}),
        ...(req.user?.userId ? { createdById: req.user.userId } : {}),
        items,
        taxAmount,
        paidAmount,
        ...(paidAmount > 0 ? { paymentMethod } : {}),
      })
    );
    const purchase = await ProductPurchaseModel.find({ id: data.id, salonId });
    return res.status(201).json({ success: true, data: purchase });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

export const getProductPurchases = async (req: Request, res: Response) => {
  try {
    const data = await ProductPurchaseModel.list(listWhere(req));
    return res.json({ success: true, data });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

export const getProductPurchase = async (req: Request, res: Response) => {
  try {
    const data = await ProductPurchaseModel.find({ id: idParam(req), ...listWhere(req) });
    if (!data) return res.status(404).json({ success: false, message: "Product purchase not found" });
    return res.json({ success: true, data });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};
