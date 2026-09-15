import { type Request, type Response } from "express";
import { applyBranchSession } from "../../utils/branch-scope.js";
import { cleanText } from "../products/inventory-access.js";
import {
  adjustLoyaltyPoints,
  findLoyaltyCustomer,
  getLoyaltyTransactions as getCustomerTransactions,
  listLoyaltyTransactions,
} from "./loyalty.service.js";
import { requestAuditContext } from "../audit-logs/audit-log.service.js";
import { parsePagination } from "../../utils/pagination.js";
import type { LoyaltyTransactionType } from "../../generated/prisma/client.js";
import { isUuid } from "../../middlewares/uuid.middleware.js";

const LOYALTY_TYPES = [
  "EARNED",
  "REDEEMED",
  "ADJUSTED",
  "EXPIRED",
] as const;

const customerIdParam = (req: Request) =>
  typeof req.params.customerId === "string" ? req.params.customerId : "";

const customerAccess = (req: Request) => ({
  salonId:
    req.user?.role === "SUPER_ADMIN" ? undefined : req.user?.salonId,
  branchId: applyBranchSession(
    req,
    req.user?.role === "RECEPTIONIST" || req.user?.role === "BRANCH_MANAGER"
      ? req.user.branchId
      : undefined
  ),
});

const sendError = (res: Response, error: unknown) => {
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : 500;
  const message =
    error instanceof Error && status !== 500
      ? error.message
      : "Internal server error";

  return res.status(status).json({
    success: false,
    message,
  });
};

export const getCustomerLoyaltyTransactions = async (
  req: Request,
  res: Response
) => {
  try {
    const customerId = customerIdParam(req);
    const access = customerAccess(req);
    const customer = await findLoyaltyCustomer(
      customerId,
      access.salonId,
      access.branchId
    );

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    const transactions = await getCustomerTransactions(
      customer.id,
      customer.salonId
    );

    return res.status(200).json({
      success: true,
      message: "Loyalty transactions fetched successfully",
      data: {
        customer,
        transactions,
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
};

const parseDate = (value: unknown, endOfDay = false) => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
};

export const getLoyaltyTransactions = async (
  req: Request,
  res: Response
) => {
  try {
    const pagination = parsePagination(req.query);
    if ("error" in pagination) {
      return res.status(400).json({
        success: false,
        message: pagination.error,
      });
    }

    const customerId =
      typeof req.query.customerId === "string"
        ? req.query.customerId
        : undefined;
    if (customerId && !isUuid(customerId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid customer ID format",
      });
    }

    const rawType =
      typeof req.query.type === "string"
        ? req.query.type.toUpperCase()
        : undefined;
    if (
      rawType &&
      !LOYALTY_TYPES.includes(rawType as LoyaltyTransactionType)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid loyalty transaction type",
      });
    }

    const startDate = parseDate(req.query.startDate);
    const endDate = parseDate(req.query.endDate, true);
    if (startDate === null || endDate === null) {
      return res.status(400).json({
        success: false,
        message: "Invalid date range",
      });
    }
    if (startDate && endDate && startDate > endDate) {
      return res.status(400).json({
        success: false,
        message: "startDate must not be after endDate",
      });
    }

    const salonId =
      req.user?.role === "SUPER_ADMIN"
        ? typeof req.query.salonId === "string"
          ? req.query.salonId
          : undefined
        : req.user?.salonId ?? "__missing__";
    const branchId = applyBranchSession(
      req,
      (req.user?.role === "BRANCH_MANAGER" ||
        req.user?.role === "RECEPTIONIST") &&
      req.user.branchId
        ? req.user.branchId
        : undefined
    );

    const result = await listLoyaltyTransactions({
      page: pagination.page,
      limit: pagination.limit,
      skip: pagination.skip,
      ...(salonId ? { salonId } : {}),
      ...(branchId ? { branchId } : {}),
      ...(customerId ? { customerId } : {}),
      ...(rawType
        ? { type: rawType as LoyaltyTransactionType }
        : {}),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
      ...(typeof req.query.referenceType === "string" &&
      req.query.referenceType.trim()
        ? { referenceType: req.query.referenceType.trim() }
        : {}),
      ...(typeof req.query.referenceId === "string" &&
      req.query.referenceId.trim()
        ? { referenceId: req.query.referenceId.trim() }
        : {}),
      ...(typeof req.query.search === "string" &&
      req.query.search.trim()
        ? { search: req.query.search.trim() }
        : {}),
    });

    return res.status(200).json({
      success: true,
      message: "Loyalty transactions fetched successfully",
      ...result,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const adjustCustomerLoyaltyPoints = async (
  req: Request,
  res: Response
) => {
  try {
    const points = Number(req.body.points);

    if (
      !Number.isInteger(points) ||
      points === 0 ||
      typeof req.body.points === "boolean" ||
      req.body.points === null ||
      req.body.points === ""
    ) {
      return res.status(400).json({
        success: false,
        message: "Points must be a non-zero integer",
      });
    }

    const customerId = customerIdParam(req);
    const access = customerAccess(req);
    const customer = await findLoyaltyCustomer(
      customerId,
      access.salonId,
      access.branchId
    );

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    if (!req.user?.userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const note = cleanText(req.body.note);
    const data = await adjustLoyaltyPoints({
      customerId: customer.id,
      salonId: customer.salonId,
      points,
      createdById: req.user.userId,
      ...(note ? { note } : {}),
      ...requestAuditContext(req),
    });

    return res.status(200).json({
      success: true,
      message: "Loyalty points adjusted successfully",
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};
