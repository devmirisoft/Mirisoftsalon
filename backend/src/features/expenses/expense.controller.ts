import { type Request, type Response } from "express";
import { prisma } from "../../config/prisma.js";
import {
  branchScope,
  cleanText,
  getSalonId,
  sendInventoryError,
  validateBranch,
  writableBranch,
} from "../products/inventory-access.js";
import { isBranchLockedRole } from "../../utils/branch-scope.js";
import { ExpenseModel } from "./expense.model.js";
import { buildBusinessCode } from "../../utils/business-id.js";

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

const accessWhere = (req: Request, id?: string) => ({
  ...(id ? { id } : {}),
  ...(req.user?.role === "SUPER_ADMIN"
    ? typeof req.query.salonId === "string"
      ? { salonId: req.query.salonId }
      : {}
    : { salonId: req.user?.salonId || "__missing__" }),
  ...branchScope(req),
});

const validateReferences = async (
  salonId: string,
  branchId?: string | null,
  vendorId?: string | null
) => {
  if (!(await validateBranch(salonId, branchId))) {
    return "Invalid branch for this salon";
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

const resolveCategory = async (
  salonId: string,
  categoryDefinitionId: string | undefined,
  categoryValue: unknown
) => {
  if (categoryDefinitionId) {
    const definition = await prisma.expenseCategoryDefinition.findFirst({
      where: { id: categoryDefinitionId, salonId },
      select: { id: true, name: true, status: true },
    });
    if (!definition) return { error: "Invalid expense category for this salon" };
    if (!definition.status) return { error: "Expense category is inactive" };
    return { id: definition.id, name: definition.name };
  }

  const name = cleanText(categoryValue);
  if (!name) return { error: "Expense category is required" };
  const definition = await prisma.expenseCategoryDefinition.findFirst({
    where: { salonId, name: { equals: name, mode: "insensitive" } },
    select: { id: true, name: true, status: true },
  });
  if (definition && !definition.status) {
    return { error: "Expense category is inactive" };
  }
  return definition
    ? { id: definition.id, name: definition.name }
    : { name };
};

export const createExpense = async (req: Request, res: Response) => {
  try {
    const salonId = getSalonId(req, req.body.salonId);
    const title = cleanText(req.body.title);
    const amount = Number(req.body.amount);
    const categoryDefinitionId = cleanText(req.body.categoryDefinitionId);
    const method = req.body.paymentMethod as PaymentMethod | undefined;
    if (!salonId || !title) {
      return res.status(400).json({
        success: false,
        message: "Salon and title are required",
      });
    }
    const category = await resolveCategory(
      salonId,
      categoryDefinitionId,
      req.body.category
    );
    if (category.error || !category.name) {
      return res.status(400).json({
        success: false,
        message: category.error || "Expense category is required",
      });
    }
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({
        success: false,
        message: "Expense amount must be a non-negative number",
      });
    }
    if (method && !PAYMENT_METHODS.includes(method)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid payment method" });
    }
    const branchId = writableBranch(req, req.body.branchId);
    const vendorId = cleanText(req.body.vendorId);
    const referenceError = await validateReferences(
      salonId,
      branchId,
      vendorId
    );
    if (referenceError) {
      return res
        .status(400)
        .json({ success: false, message: referenceError });
    }
    const salon = await prisma.salon.findUnique({
      where: { id: salonId },
      select: { name: true, timezone: true },
    });
    if (!salon) {
      return res.status(400).json({ success: false, message: "Invalid salon" });
    }
    const expenseDate = req.body.expenseDate
      ? new Date(req.body.expenseDate)
      : undefined;
    if (expenseDate && Number.isNaN(expenseDate.getTime())) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid expense date" });
    }
    const description = cleanText(req.body.description);
    const note = cleanText(req.body.note);
    const data = await ExpenseModel.create({
      expenseCode: buildBusinessCode({
        salonName: salon.name,
        type: "EXP",
        timezone: salon.timezone,
      }),
      salon: { connect: { id: salonId } },
      title,
      amount,
      category: category.name,
      ...(category.id
        ? { categoryDefinition: { connect: { id: category.id } } }
        : {}),
      ...(branchId ? { branch: { connect: { id: branchId } } } : {}),
      ...(vendorId ? { vendor: { connect: { id: vendorId } } } : {}),
      ...(method ? { paymentMethod: method } : {}),
      ...(expenseDate ? { expenseDate } : {}),
      ...(description ? { description } : {}),
      ...(note ? { note } : {}),
      ...(req.user?.userId
        ? { createdBy: { connect: { id: req.user.userId } } }
        : {}),
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

export const getExpenses = async (req: Request, res: Response) => {
  try {
    const category = cleanText(req.query.category);
    const from =
      typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
    const to =
      typeof req.query.to === "string" ? new Date(req.query.to) : undefined;
    if (
      (from && Number.isNaN(from.getTime())) ||
      (to && Number.isNaN(to.getTime()))
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid date range" });
    }
    const data = await ExpenseModel.list({
      ...accessWhere(req),
      ...(typeof req.query.branchId === "string"
        ? { branchId: req.query.branchId }
        : {}),
      ...(typeof req.query.vendorId === "string"
        ? { vendorId: req.query.vendorId }
        : {}),
      ...(category ? { category } : {}),
      ...(from || to
        ? {
            expenseDate: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    });
    return res.json({ success: true, data });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

export const getExpense = async (req: Request, res: Response) => {
  try {
    const data = await ExpenseModel.find(accessWhere(req, idParam(req)));
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Expense not found" });
    }
    return res.json({ success: true, data });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

export const updateExpense = async (req: Request, res: Response) => {
  try {
    const existing = await ExpenseModel.find(accessWhere(req, idParam(req)));
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Expense not found" });
    }
    const title =
      req.body.title === undefined ? undefined : cleanText(req.body.title);
    if (req.body.title !== undefined && !title) {
      return res
        .status(400)
        .json({ success: false, message: "Expense title is required" });
    }
    const amount =
      req.body.amount === undefined ? undefined : Number(req.body.amount);
    if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
      return res.status(400).json({
        success: false,
        message: "Expense amount must be a non-negative number",
      });
    }
    const categoryDefinitionId =
      "categoryDefinitionId" in req.body
        ? cleanText(req.body.categoryDefinitionId) ?? null
        : undefined;
    const category =
      categoryDefinitionId !== undefined || req.body.category !== undefined
        ? await resolveCategory(
            existing.salonId,
            categoryDefinitionId ?? undefined,
            req.body.category ?? existing.category
          )
        : undefined;
    if (category?.error || (category && !category.name)) {
      return res.status(400).json({
        success: false,
        message: category.error || "Expense category is required",
      });
    }
    const method = req.body.paymentMethod as PaymentMethod | null | undefined;
    if (method && !PAYMENT_METHODS.includes(method)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid payment method" });
    }
    // A branch-locked caller cannot move an expense to another branch.
    const branchId =
      "branchId" in req.body && !isBranchLockedRole(req.user?.role)
        ? cleanText(req.body.branchId) ?? null
        : undefined;
    const vendorId =
      "vendorId" in req.body ? cleanText(req.body.vendorId) ?? null : undefined;
    const referenceError = await validateReferences(
      existing.salonId,
      branchId,
      vendorId
    );
    if (referenceError) {
      return res
        .status(400)
        .json({ success: false, message: referenceError });
    }
    const expenseDate = req.body.expenseDate
      ? new Date(req.body.expenseDate)
      : undefined;
    if (expenseDate && Number.isNaN(expenseDate.getTime())) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid expense date" });
    }
    const data = await ExpenseModel.update(existing.id, {
      ...(title ? { title } : {}),
      ...(amount !== undefined ? { amount } : {}),
      ...(category?.name ? { category: category.name } : {}),
      ...(categoryDefinitionId !== undefined
        ? category?.id
          ? { categoryDefinition: { connect: { id: category.id } } }
          : { categoryDefinition: { disconnect: true } }
        : {}),
      ...(expenseDate ? { expenseDate } : {}),
      ...(method !== undefined ? { paymentMethod: method } : {}),
      ...(branchId !== undefined
        ? branchId
          ? { branch: { connect: { id: branchId } } }
          : { branch: { disconnect: true } }
        : {}),
      ...(vendorId !== undefined
        ? vendorId
          ? { vendor: { connect: { id: vendorId } } }
          : { vendor: { disconnect: true } }
        : {}),
      ...(req.body.description !== undefined
        ? { description: cleanText(req.body.description) ?? null }
        : {}),
      ...(req.body.note !== undefined
        ? { note: cleanText(req.body.note) ?? null }
        : {}),
    });
    return res.json({ success: true, data });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

export const deleteExpense = async (req: Request, res: Response) => {
  try {
    const existing = await ExpenseModel.find(accessWhere(req, idParam(req)));
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Expense not found" });
    }
    await ExpenseModel.remove(existing.id);
    return res.json({ success: true, message: "Expense deleted" });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};
