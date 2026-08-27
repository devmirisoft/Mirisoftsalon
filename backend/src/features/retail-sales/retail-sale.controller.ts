import { randomUUID } from "node:crypto";
import { type Request, type Response } from "express";
import { prisma } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import {
  getSalonId,
  sendInventoryError,
  transactionError,
  validateBranch,
} from "../products/inventory-access.js";
import { RetailSaleModel } from "./retail-sale.model.js";
import { createStockMovement } from "../stock/stockMovement.service.js";
import { buildBusinessCode } from "../../utils/business-id.js";
import { requestAuditContext } from "../audit-logs/audit-log.service.js";
import { resolveCurrentCustomerMembership } from "../customer-memberships/customer-membership.service.js";

const PAYMENT_METHODS = ["CASH", "UPI", "GPAY", "PAYTM", "PHONEPE", "CARD", "BANK_TRANSFER", "CHEQUE", "OTHER"] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];
type SaleItem = { productId: string; quantity: number; unitPrice: number };
const idParam = (req: Request) => typeof req.params.id === "string" ? req.params.id : "";
const listWhere = (req: Request) => ({
  ...(req.user?.role === "SUPER_ADMIN"
    ? typeof req.query.salonId === "string"
      ? { salonId: req.query.salonId }
      : {}
    : { salonId: req.user?.salonId || "__missing__" }),
  ...((req.user?.role === "RECEPTIONIST" || req.user?.role === "BRANCH_MANAGER") && req.user.branchId
    ? { branchId: req.user.branchId }
    : {}),
});

export const createRetailSale = async (req: Request, res: Response) => {
  try {
    const salonId = getSalonId(req, req.body.salonId);
    const branchId =
      req.user?.role === "RECEPTIONIST" || req.user?.role === "BRANCH_MANAGER"
        ? req.user.branchId
        : typeof req.body.branchId === "string" && req.body.branchId
          ? req.body.branchId
          : undefined;
    if (!salonId) return res.status(400).json({ success: false, message: "Salon is required" });
    if (!(await validateBranch(salonId, branchId))) return res.status(400).json({ success: false, message: "Invalid branch for this salon" });
    if (req.body.paymentMethod && !PAYMENT_METHODS.includes(req.body.paymentMethod as PaymentMethod)) {
      return res.status(400).json({ success: false, message: "Invalid payment method" });
    }
    if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
      return res.status(400).json({ success: false, message: "At least one retail sale item is required" });
    }
    const items: SaleItem[] = req.body.items.map((item: Record<string, unknown>) => ({
      productId: typeof item.productId === "string" ? item.productId : "",
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
    }));
    if (items.some((item) => !item.productId || !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unitPrice) || item.unitPrice < 0)) {
      return res.status(400).json({ success: false, message: "Sale quantities must be positive and prices non-negative" });
    }
    if (new Set(items.map((item) => item.productId)).size !== items.length) {
      return res.status(400).json({ success: false, message: "Each product may appear only once per sale" });
    }
    const discount = Number(req.body.discountAmount ?? 0);
    if (!Number.isFinite(discount) || discount < 0) return res.status(400).json({ success: false, message: "Discount must be non-negative" });
    const taxPercent = Number(req.body.taxPercent ?? 0);
    if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) {
      return res.status(400).json({ success: false, message: "Tax percent must be between 0 and 100" });
    }
    const saleDate = req.body.saleDate ? new Date(req.body.saleDate) : undefined;
    const staffId = typeof req.body.staffId === "string" && req.body.staffId ? req.body.staffId : undefined;
    if (saleDate && Number.isNaN(saleDate.getTime())) {
      return res.status(400).json({ success: false, message: "Invalid sale date" });
    }

    const saleId = await prisma.$transaction(async (tx) => {
      const salon = await tx.salon.findUnique({
        where: { id: salonId },
        select: { name: true, timezone: true },
      });
      if (!salon) throw transactionError("Invalid salon");
      const products = await tx.product.findMany({
        where: { id: { in: items.map((item) => item.productId) }, salonId },
      });
      if (products.length !== items.length) throw transactionError("One or more products were not found", 404);
      if (products.some((product) => !product.status)) throw transactionError("Inactive products cannot be sold");
      if (products.some((product) => !product.isRetailProduct)) throw transactionError("Only retail products can be sold");
      if (branchId && products.some((product) => product.branchId && product.branchId !== branchId)) {
        throw transactionError("A product does not belong to the selected branch");
      }
      if (req.body.customerId) {
        const customer = await tx.customer.findFirst({ where: { id: req.body.customerId, salonId }, select: { id: true } });
        if (!customer) throw transactionError("Customer not found", 404);
      }
      if (staffId) {
        const staff = await tx.staff.findFirst({
          where: { id: staffId, salonId },
          select: { id: true, branchId: true },
        });
        if (!staff) throw transactionError("Credited staff not found in this salon", 404);
        if (branchId && staff.branchId !== branchId) {
          throw transactionError("Credited staff does not belong to the selected branch");
        }
      }
      const subtotal = new Prisma.Decimal(
        items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
      ).toDecimalPlaces(2);
      if (new Prisma.Decimal(discount).gt(subtotal)) throw transactionError("Discount cannot exceed subtotal");
      const customerMembership =
        req.body.customerId && req.user?.userId
          ? await resolveCurrentCustomerMembership(tx, {
              customerId: req.body.customerId,
              actor: {
                userId: req.user.userId,
                role: req.user.role,
                ...(req.user.salonId ? { salonId: req.user.salonId } : {}),
                ...(req.user.branchId ? { branchId: req.user.branchId } : {}),
              },
              audit: requestAuditContext(req),
            })
          : null;
      const manualDiscount = new Prisma.Decimal(discount).toDecimalPlaces(2);
      const membershipDiscount = customerMembership
        ? Prisma.Decimal.min(
            subtotal.mul(customerMembership.discountPercentageSnapshot).div(100),
            subtotal.minus(manualDiscount)
          ).toDecimalPlaces(2)
        : new Prisma.Decimal(0);
      const totalDiscount = Prisma.Decimal.min(
        manualDiscount.plus(membershipDiscount),
        subtotal
      ).toDecimalPlaces(2);
      const taxableAmount = subtotal.minus(totalDiscount);
      const taxAmount = taxableAmount
        .mul(taxPercent)
        .div(100)
        .toDecimalPlaces(2);
      const totalAmount = taxableAmount.plus(taxAmount).toDecimalPlaces(2);
      const saleId = randomUUID();
      for (const item of [...items].sort((left, right) => left.productId.localeCompare(right.productId))) {
        await createStockMovement({
          tx,
          salonId,
          ...(branchId ? { branchId } : {}),
          productId: item.productId,
          type: "RETAIL_SALE",
          quantity: item.quantity,
          referenceType: "RETAIL_SALE",
          referenceId: saleId,
          ...(req.user?.userId ? { createdById: req.user.userId } : {}),
        });
      }
      const sale = await tx.retailSale.create({
        data: {
          id: saleId,
          saleCode: buildBusinessCode({
            salonName: salon.name,
            type: "RET",
            timezone: salon.timezone,
          }),
          salonId,
          ...(branchId ? { branchId } : {}),
          ...(req.body.customerId ? { customerId: req.body.customerId } : {}),
          ...(staffId ? { staffId } : {}),
          ...(saleDate ? { saleDate } : {}),
          subtotalAmount: subtotal,
          discountAmount: totalDiscount,
          taxPercent,
          taxAmount,
          totalAmount,
          ...(req.body.paymentMethod ? { paymentMethod: req.body.paymentMethod as PaymentMethod } : {}),
          ...(typeof req.body.note === "string" && req.body.note.trim() ? { note: req.body.note.trim() } : {}),
          ...(req.user?.userId ? { createdById: req.user.userId } : {}),
          items: {
            create: items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.quantity * item.unitPrice,
            })),
          },
        },
      });
      return sale.id;
    });
    const data = await RetailSaleModel.find({ id: saleId, salonId });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

export const getRetailSales = async (req: Request, res: Response) => {
  try {
    const data = await RetailSaleModel.list(listWhere(req));
    return res.json({ success: true, data });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

export const getRetailSale = async (req: Request, res: Response) => {
  try {
    const data = await RetailSaleModel.find({ id: idParam(req), ...listWhere(req) });
    if (!data) return res.status(404).json({ success: false, message: "Retail sale not found" });
    return res.json({ success: true, data });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};
