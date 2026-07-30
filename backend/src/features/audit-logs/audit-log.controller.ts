import { type Request, type Response } from "express";
import {
  Prisma,
  type AuditAction,
  type AuditModule,
} from "../../generated/prisma/client.js";
import { paginationMeta, parsePagination } from "../../utils/pagination.js";
import { AuditLogModel } from "./audit-log.model.js";

const MODULES = [
  "AUTH",
  "APPOINTMENT",
  "INVOICE",
  "PAYMENT",
  "SALARY",
  "CUSTOMER",
  "STAFF",
  "INVENTORY",
  "SUPPORT_TICKET",
  "REORDER",
  "MEMBERSHIP",
  "LOYALTY",
  "COUPON",
  "GST",
  "PUBLIC_BOOKING",
  "JOB_CART",
  "PACKAGE",
  "SYSTEM",
] as const;

const ACTIONS = [
  "LOGIN_SUCCESS",
  "LOGIN_FAILED",
  "LOGOUT",
  "CREATE",
  "UPDATE",
  "DELETE",
  "CANCEL",
  "COMPLETE",
  "PAYMENT_RECORDED",
  "STOCK_MOVEMENT",
  "SALARY_CHANGED",
  "SALARY_GENERATED",
  "SALARY_PAID",
  "SUPPORT_RESOLVED",
  "APPROVE",
  "REJECT",
  "CONVERT",
  "STATUS_CHANGE",
] as const;

const accessWhere = (req: Request): Prisma.AuditLogWhereInput => {
  if (req.user?.role === "SUPER_ADMIN") {
    return typeof req.query.salonId === "string"
      ? { salonId: req.query.salonId }
      : {};
  }
  if (req.user?.role === "BRANCH_MANAGER") {
    return {
      salonId: req.user.salonId ?? "__missing__",
      branchId: req.user.branchId ?? "__missing__",
    };
  }
  return { salonId: req.user?.salonId ?? "__missing__" };
};

const branchFilter = (req: Request): Prisma.AuditLogWhereInput => {
  if (req.user?.role === "BRANCH_MANAGER") return {};
  return typeof req.query.branchId === "string"
    ? { branchId: req.query.branchId }
    : {};
};

const parseDate = (value: unknown, endOfDay = false) => {
  if (typeof value !== "string" || !value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
};

export const getAuditLogs = async (req: Request, res: Response) => {
  try {
    const pagination = parsePagination(req.query);
    if ("error" in pagination) {
      return res.status(400).json({ success: false, message: pagination.error });
    }
    const module =
      typeof req.query.module === "string"
        ? req.query.module.toUpperCase()
        : undefined;
    const action =
      typeof req.query.action === "string"
        ? req.query.action.toUpperCase()
        : undefined;
    if (module && !MODULES.includes(module as AuditModule)) {
      return res.status(400).json({ success: false, message: "Invalid audit module" });
    }
    if (action && !ACTIONS.includes(action as AuditAction)) {
      return res.status(400).json({ success: false, message: "Invalid audit action" });
    }
    const startDate = parseDate(req.query.startDate);
    const endDate = parseDate(req.query.endDate, true);
    if (startDate === null || endDate === null) {
      return res.status(400).json({ success: false, message: "Invalid date filter" });
    }
    const search =
      typeof req.query.search === "string" && req.query.search.trim()
        ? req.query.search.trim()
        : undefined;
    const where: Prisma.AuditLogWhereInput = {
      ...accessWhere(req),
      ...branchFilter(req),
      ...(typeof req.query.userId === "string"
        ? { userId: req.query.userId }
        : {}),
      ...(module ? { module: module as AuditModule } : {}),
      ...(action ? { action: action as AuditAction } : {}),
      ...(typeof req.query.entityId === "string"
        ? { entityId: req.query.entityId }
        : {}),
      ...(startDate || endDate
        ? {
            createdAt: {
              ...(startDate ? { gte: startDate } : {}),
              ...(endDate ? { lte: endDate } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { description: { contains: search, mode: "insensitive" } },
              { userName: { contains: search, mode: "insensitive" } },
              { entityCode: { contains: search, mode: "insensitive" } },
              { entityName: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [data, total] = await AuditLogModel.list(where, {
      skip: pagination.skip,
      take: pagination.limit,
    });
    return res.json({
      success: true,
      data,
      pagination: paginationMeta(pagination.page, pagination.limit, total),
    });
  } catch {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const getAuditLog = async (req: Request, res: Response) => {
  try {
    const data = await AuditLogModel.find({
      id: typeof req.params.id === "string" ? req.params.id : "",
      ...accessWhere(req),
    });
    if (!data) {
      return res.status(404).json({ success: false, message: "Audit log not found" });
    }
    return res.json({ success: true, data });
  } catch {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
