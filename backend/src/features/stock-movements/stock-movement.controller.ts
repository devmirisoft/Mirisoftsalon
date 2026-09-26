import { type Request, type Response } from "express";
import { prisma } from "../../config/prisma.js";
import {
  branchScope,
  getSalonId,
  sendInventoryError,
  writableBranch,
} from "../products/inventory-access.js";
import { StockMovementModel } from "./stock-movement.model.js";
import { createStockMovement, isInventoryLocation } from "../stock/stockMovement.service.js";

const TYPES = ["STOCK_IN", "STOCK_OUT", "RETAIL_SALE", "USED_IN_SERVICE", "DAMAGED", "ADJUSTMENT", "RETURNED", "TRANSFER", "OPEN_CONTAINER", "WASTAGE", "LOST"] as const;
type MovementType = (typeof TYPES)[number];
// Transfers and opened packs have their own endpoints under /api/inventory.
const MANUAL_TYPES: readonly MovementType[] = TYPES.filter((type) => type !== "TRANSFER" && type !== "OPEN_CONTAINER");

const baseWhere = (req: Request) => ({
  ...(req.user?.role === "SUPER_ADMIN" ? {} : { salonId: req.user?.salonId || "__missing__" }),
  ...branchScope(req),
});

export const createManualStockMovement = async (req: Request, res: Response) => {
  try {
    const salonId = getSalonId(req, req.body.salonId);
    const productId = typeof req.body.productId === "string" ? req.body.productId : "";
    const type = req.body.type as MovementType;
    const quantity = Number(req.body.quantity);
    if (!salonId || !productId || !MANUAL_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: "Product, salon and valid movement type are required" });
    }
    const location = req.body.location;
    if (location !== undefined && location !== null && location !== "" && !isInventoryLocation(location)) {
      return res.status(400).json({ success: false, message: "Location must be WAREHOUSE, RETAIL or SERVICE" });
    }
    if (type === "RETAIL_SALE") {
      return res.status(400).json({ success: false, message: "RETAIL_SALE movements must be created through retail sales" });
    }
    if (!Number.isFinite(quantity) || quantity === 0 || (type !== "ADJUSTMENT" && quantity < 0)) {
      return res.status(400).json({ success: false, message: "Quantity must be positive; adjustments may be positive or negative" });
    }
    // Branch-locked callers may only move stock they can see.
    const product = await prisma.product.findFirst({
      where: { id: productId, ...baseWhere(req) },
      select: { id: true },
    });
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    const branchId = writableBranch(req, req.body.branchId);
    const data = await prisma.$transaction(async (tx) => {
      const result = await createStockMovement({
        tx,
        salonId,
        productId,
        type,
        quantity,
        ...(isInventoryLocation(location) ? { location } : {}),
        // The branch whose shelf is being corrected: the caller's own branch
        // when pinned to one, otherwise the product's.
        ...(branchId ? { branchId } : {}),
        referenceType: "MANUAL",
        ...(typeof req.body.referenceId === "string" && req.body.referenceId.trim()
          ? { referenceId: req.body.referenceId.trim() }
          : {}),
        ...(typeof req.body.reason === "string" && req.body.reason.trim()
          ? { reason: req.body.reason.trim() }
          : {}),
        ...(typeof req.body.note === "string" && req.body.note.trim()
          ? { note: req.body.note.trim() }
          : {}),
        ...(req.user?.userId ? { createdById: req.user.userId } : {}),
      });
      return result.movement;
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

export const getStockMovements = async (req: Request, res: Response) => {
  try {
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    if (type && !TYPES.includes(type as MovementType)) {
      return res.status(400).json({ success: false, message: "Invalid movement type" });
    }
    const from = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
    const to = typeof req.query.to === "string" ? new Date(req.query.to) : undefined;
    const data = await StockMovementModel.list({
      ...baseWhere(req),
      ...(typeof req.query.productId === "string" ? { productId: req.query.productId } : {}),
      ...(type ? { type: type as MovementType } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    });
    return res.json({ success: true, data });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

export const getProductStockMovements = async (req: Request, res: Response) => {
  try {
    const productId = typeof req.params.productId === "string" ? req.params.productId : "";
    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        ...(req.user?.role === "SUPER_ADMIN" ? {} : { salonId: req.user?.salonId || "__missing__" }),
        ...branchScope(req),
      },
      select: { id: true },
    });
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    const data = await StockMovementModel.list({ ...baseWhere(req), productId });
    return res.json({ success: true, data });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};
