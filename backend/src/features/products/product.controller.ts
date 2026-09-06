import { type Request, type Response } from "express";
import { ProductModel } from "./product.model.js";
import { prisma } from "../../config/prisma.js";
import {
  branchScope,
  writableBranch,
  cleanText,
  getSalonId,
  numberValue,
  sendInventoryError,
  validateBranch,
} from "./inventory-access.js";
import { isBranchLockedRole } from "../../utils/branch-scope.js";

const UNITS = ["PCS", "ML", "LITER", "GRAM", "KG", "PACK", "BOX", "BOTTLE", "TUBE"] as const;
type ProductUnit = (typeof UNITS)[number];
const idParam = (req: Request) => typeof req.params.id === "string" ? req.params.id : "";
const isUnit = (value: unknown): value is ProductUnit =>
  typeof value === "string" && UNITS.includes(value as ProductUnit);

const accessWhere = (req: Request, id?: string) => ({
  ...(id ? { id } : {}),
  ...(req.user?.role === "SUPER_ADMIN"
    ? typeof req.query.salonId === "string"
      ? { salonId: req.query.salonId }
      : {}
    : { salonId: req.user?.salonId || "__missing__" }),
  ...branchScope(req),
});

const checkReferences = async (
  salonId: string,
  brandId?: string | null,
  branchId?: string | null,
  vendorId?: string | null
) => {
  if (!(await validateBranch(salonId, branchId))) return "Invalid branch for this salon";
  if (brandId) {
    const brand = await prisma.productBrand.findFirst({
      where: { id: brandId, salonId },
      select: { id: true },
    });
    if (!brand) return "Invalid brand for this salon";
  }
  if (vendorId) {
    const vendor = await prisma.vendor.findFirst({
      where: { id: vendorId, salonId },
      select: { id: true },
    });
    if (!vendor) return "Invalid vendor for this salon";
  }
  return null;
};

export const createProduct = async (req: Request, res: Response) => {
  try {
    const name = cleanText(req.body.name);
    const salonId = getSalonId(req, req.body.salonId);
    const costPrice = numberValue(req.body.costPrice ?? 0);
    const sellingPrice = numberValue(req.body.sellingPrice ?? 0);
    const lowStockAlert = numberValue(req.body.lowStockAlert ?? 0);
    const description = cleanText(req.body.description);
    const sku = cleanText(req.body.sku);
    const barcode = cleanText(req.body.barcode);
    const category = cleanText(req.body.category);
    if (!name || !salonId) return res.status(400).json({ success: false, message: "Product name and salon are required" });
    if (![costPrice, sellingPrice, lowStockAlert].every((value) => Number.isFinite(value) && value >= 0)) {
      return res.status(400).json({ success: false, message: "Prices and low stock alert must be non-negative numbers" });
    }
    if (req.body.unit && !isUnit(req.body.unit)) {
      return res.status(400).json({ success: false, message: "Invalid product unit" });
    }
    const branchId = writableBranch(req, req.body.branchId);
    const referenceError = await checkReferences(
      salonId,
      req.body.brandId,
      branchId,
      req.body.vendorId
    );
    if (referenceError) return res.status(400).json({ success: false, message: referenceError });
    if (await ProductModel.duplicate(salonId, name)) {
      return res.status(409).json({ success: false, message: "Product already exists" });
    }
    const data = await ProductModel.create({
      salon: { connect: { id: salonId } },
      name,
      costPrice,
      sellingPrice,
      lowStockAlert,
      ...(description ? { description } : {}),
      ...(sku ? { sku } : {}),
      ...(barcode ? { barcode } : {}),
      ...(category ? { category } : {}),
      ...(req.body.unit ? { unit: req.body.unit as ProductUnit } : {}),
      ...(typeof req.body.isRetailProduct === "boolean" ? { isRetailProduct: req.body.isRetailProduct } : {}),
      ...(typeof req.body.isServiceConsumable === "boolean" ? { isServiceConsumable: req.body.isServiceConsumable } : {}),
      ...(req.body.brandId ? { brand: { connect: { id: req.body.brandId } } } : {}),
      ...(req.body.vendorId ? { vendor: { connect: { id: req.body.vendorId } } } : {}),
      ...(branchId ? { branch: { connect: { id: branchId } } } : {}),
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

export const getProducts = async (req: Request, res: Response) => {
  try {
    const where = {
      ...accessWhere(req),
      ...(typeof req.query.brandId === "string" ? { brandId: req.query.brandId } : {}),
      ...(typeof req.query.category === "string" ? { category: req.query.category } : {}),
      ...(typeof req.query.vendorId === "string" ? { vendorId: req.query.vendorId } : {}),
      ...(req.query.status === "true" || req.query.status === "false"
        ? { status: req.query.status === "true" }
        : {}),
      ...(req.query.retail === "true" || req.query.retail === "false"
        ? { isRetailProduct: req.query.retail === "true" }
        : {}),
      ...(req.query.serviceConsumable === "true" || req.query.serviceConsumable === "false"
        ? { isServiceConsumable: req.query.serviceConsumable === "true" }
        : {}),
    };
    const data = await ProductModel.list(where);
    return res.json({ success: true, data });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

export const getLowStockProducts = async (req: Request, res: Response) => {
  try {
    const products = await ProductModel.list(accessWhere(req));
    const data = products.filter(
      (product) =>
        product.status &&
        Number(product.lowStockAlert) > 0 &&
        Number(product.currentStock) <= Number(product.lowStockAlert)
    ).map((product) => ({
      ...product,
      requiredQuantity: Math.max(
        Number(product.lowStockAlert) - Number(product.currentStock),
        0
      ),
    }));
    return res.json({ success: true, data });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

export const getProduct = async (req: Request, res: Response) => {
  try {
    const data = await ProductModel.find(accessWhere(req, idParam(req)));
    if (!data) return res.status(404).json({ success: false, message: "Product not found" });
    return res.json({ success: true, data });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

export const updateProduct = async (req: Request, res: Response) => {
  try {
    const existing = await ProductModel.find(accessWhere(req, idParam(req)));
    if (!existing) return res.status(404).json({ success: false, message: "Product not found" });
    const name = req.body.name === undefined ? undefined : cleanText(req.body.name);
    if (req.body.name !== undefined && !name) return res.status(400).json({ success: false, message: "Product name is required" });
    for (const key of ["costPrice", "sellingPrice", "lowStockAlert"] as const) {
      if (req.body[key] !== undefined && (!Number.isFinite(Number(req.body[key])) || Number(req.body[key]) < 0)) {
        return res.status(400).json({ success: false, message: `${key} must be a non-negative number` });
      }
    }
    if (req.body.unit !== undefined && !isUnit(req.body.unit)) {
      return res.status(400).json({ success: false, message: "Invalid product unit" });
    }
    const canMoveBranch = !isBranchLockedRole(req.user?.role);
    const referenceError = await checkReferences(
      existing.salonId,
      req.body.brandId,
      canMoveBranch ? req.body.branchId : undefined,
      req.body.vendorId
    );
    if (referenceError) return res.status(400).json({ success: false, message: referenceError });
    if (name && await ProductModel.duplicate(existing.salonId, name, existing.id)) {
      return res.status(409).json({ success: false, message: "Product already exists" });
    }
    const data = await ProductModel.update(existing.id, {
      ...(name ? { name } : {}),
      ...("description" in req.body ? { description: cleanText(req.body.description) ?? null } : {}),
      ...("sku" in req.body ? { sku: cleanText(req.body.sku) ?? null } : {}),
      ...("barcode" in req.body ? { barcode: cleanText(req.body.barcode) ?? null } : {}),
      ...("category" in req.body ? { category: cleanText(req.body.category) ?? null } : {}),
      ...(req.body.unit ? { unit: req.body.unit as ProductUnit } : {}),
      ...(req.body.costPrice !== undefined ? { costPrice: Number(req.body.costPrice) } : {}),
      ...(req.body.sellingPrice !== undefined ? { sellingPrice: Number(req.body.sellingPrice) } : {}),
      ...(req.body.lowStockAlert !== undefined ? { lowStockAlert: Number(req.body.lowStockAlert) } : {}),
      ...(typeof req.body.isRetailProduct === "boolean" ? { isRetailProduct: req.body.isRetailProduct } : {}),
      ...(typeof req.body.isServiceConsumable === "boolean" ? { isServiceConsumable: req.body.isServiceConsumable } : {}),
      ...("brandId" in req.body
        ? req.body.brandId ? { brand: { connect: { id: req.body.brandId } } } : { brand: { disconnect: true } }
        : {}),
      ...(canMoveBranch && "branchId" in req.body
        ? req.body.branchId ? { branch: { connect: { id: req.body.branchId } } } : { branch: { disconnect: true } }
        : {}),
      ...("vendorId" in req.body
        ? req.body.vendorId ? { vendor: { connect: { id: req.body.vendorId } } } : { vendor: { disconnect: true } }
        : {}),
    });
    return res.json({ success: true, data });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

export const setProductStatus = async (req: Request, res: Response) => {
  try {
    if (typeof req.body.status !== "boolean") return res.status(400).json({ success: false, message: "Status must be true or false" });
    const existing = await ProductModel.find(accessWhere(req, idParam(req)));
    if (!existing) return res.status(404).json({ success: false, message: "Product not found" });
    const data = await ProductModel.update(existing.id, { status: req.body.status });
    return res.json({ success: true, data });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

export const deleteProduct = async (req: Request, res: Response) => {
  try {
    const existing = await ProductModel.find(accessWhere(req, idParam(req)));
    if (!existing) return res.status(404).json({ success: false, message: "Product not found" });
    await ProductModel.remove(existing.id);
    return res.json({ success: true, message: "Product deleted" });
  } catch {
    return res.status(409).json({ success: false, message: "Cannot delete a product with inventory history" });
  }
};
