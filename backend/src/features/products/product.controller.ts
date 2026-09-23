import { type Request, type Response } from "express";
import { ProductModel, productActivity, productSalesStats } from "./product.model.js";
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
import { isBranchPinned } from "../../utils/branch-scope.js";

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

/**
 * Pack size and unit go together: both set (e.g. 1000 ML per bottle) makes
 * service stock open into tracked containers; both empty turns it off.
 */
const packFields = (body: Record<string, unknown>, stockUnit?: string) => {
  if (!("packSize" in body) && !("packUnit" in body)) return {};
  const size = body.packSize === null || body.packSize === "" || body.packSize === undefined
    ? null
    : Number(body.packSize);
  const unit = body.packUnit === null || body.packUnit === "" || body.packUnit === undefined
    ? null
    : body.packUnit;
  if (size !== null && (!Number.isFinite(size) || size <= 0)) {
    return { error: "Pack size must be a positive number" };
  }
  if (unit !== null && !isUnit(unit)) return { error: "Invalid pack unit" };
  if ((size === null) !== (unit === null)) {
    return { error: "Set both pack size and pack unit, or neither" };
  }
  // Stock is counted in packs and content in the pack unit, so the two must be
  // different; otherwise a movement cannot say which of them it is in.
  if (unit !== null && stockUnit && unit === stockUnit) {
    return { error: "Pack unit must differ from the stock unit" };
  }
  return { data: { packSize: size, packUnit: unit as ProductUnit | null } };
};

/**
 * Consumable quantities are read in the pack unit once a product has one, so
 * "50" turns from 50 packs into 50 ml. Existing rows are never reinterpreted
 * behind the operator's back: the change has to be confirmed.
 */
const packChangeNeedsConfirmation = async (
  existing: { id: string; packSize: unknown; packUnit: unknown },
  next: { packSize: number | null; packUnit: ProductUnit | null } | undefined,
  body: Record<string, unknown>
) => {
  if (!next || body.confirmConsumableUnits === true) return null;
  const was = existing.packUnit ?? null;
  if ((next.packUnit ?? null) === was && Number(existing.packSize ?? 0) === Number(next.packSize ?? 0)) {
    return null;
  }
  const consumables = await prisma.serviceConsumable.count({
    where: { productId: existing.id, status: true },
  });
  if (!consumables) return null;
  return `This product is used by ${consumables} service consumable${consumables === 1 ? "" : "s"}. Changing the pack size or unit changes what their quantities mean (${was ?? "product unit"} to ${next.packUnit ?? "product unit"}). Re-check those quantities, then send confirmConsumableUnits: true.`;
};

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
    const hsnCode = cleanText(req.body.hsnCode);
    const category = cleanText(req.body.category);
    if (!name || !salonId) return res.status(400).json({ success: false, message: "Product name and salon are required" });
    if (![costPrice, sellingPrice, lowStockAlert].every((value) => Number.isFinite(value) && value >= 0)) {
      return res.status(400).json({ success: false, message: "Prices and low stock alert must be non-negative numbers" });
    }
    if (req.body.unit && !isUnit(req.body.unit)) {
      return res.status(400).json({ success: false, message: "Invalid product unit" });
    }
    const pack = packFields(req.body, req.body.unit ?? "PCS");
    if (pack.error) return res.status(400).json({ success: false, message: pack.error });
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
      ...(hsnCode ? { hsnCode } : {}),
      ...(category ? { category } : {}),
      ...(req.body.unit ? { unit: req.body.unit as ProductUnit } : {}),
      ...(pack.data ?? {}),
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
    const products = await ProductModel.list(where);
    const stats = await productSalesStats(products.map((product) => product.id));
    const data = products.map((product) => ({
      ...product,
      ...(stats.get(product.id) ?? { soldQty: 0, revenue: 0, saleCount: 0, lastPurchaseAt: null }),
    }));
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

export const getProductActivityHandler = async (req: Request, res: Response) => {
  try {
    const product = await ProductModel.find(accessWhere(req, idParam(req)));
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    const [activity, salon] = await Promise.all([
      productActivity(product.id),
      prisma.salon.findUnique({ where: { id: product.salonId }, select: { productGstRate: true } }),
    ]);
    return res.json({ success: true, data: { ...activity, productGstRate: Number(salon?.productGstRate ?? 0) } });
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
    const pack = packFields(req.body, req.body.unit ?? existing.unit);
    if (pack.error) return res.status(400).json({ success: false, message: pack.error });
    const confirmation = await packChangeNeedsConfirmation(existing, pack.data, req.body);
    if (confirmation) {
      return res.status(409).json({
        success: false,
        code: "CONSUMABLE_UNIT_CHANGE",
        message: confirmation,
      });
    }
    const canMoveBranch = !isBranchPinned(req.user);
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
      ...("hsnCode" in req.body ? { hsnCode: cleanText(req.body.hsnCode) ?? null } : {}),
      ...("category" in req.body ? { category: cleanText(req.body.category) ?? null } : {}),
      ...(req.body.unit ? { unit: req.body.unit as ProductUnit } : {}),
      ...(pack.data ?? {}),
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
