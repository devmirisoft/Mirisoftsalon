import { type Request } from "express";
import { prisma } from "../../config/prisma.js";
import { isBranchLockedRole } from "../../utils/branch-scope.js";

export const INVENTORY_VIEW_ROLES = [
  "SUPER_ADMIN",
  "SALON_ADMIN",
  "BRANCH_MANAGER",
  "RECEPTIONIST",
  "STAFF",
] as const;

export const getSalonId = (req: Request, requestedSalonId?: unknown) =>
  req.user?.role === "SUPER_ADMIN"
    ? typeof requestedSalonId === "string"
      ? requestedSalonId
      : undefined
    : req.user?.salonId;

export const branchScope = (req: Request) =>
  (req.user?.role === "RECEPTIONIST" || req.user?.role === "BRANCH_MANAGER") &&
  req.user.branchId
    ? { OR: [{ branchId: req.user.branchId }, { branchId: null }] }
    : {};

export const exactBranchScope = (req: Request) =>
  (req.user?.role === "RECEPTIONIST" || req.user?.role === "BRANCH_MANAGER") &&
  req.user.branchId
    ? { branchId: req.user.branchId }
    : {};

/**
 * The branch a write may target. Branch-locked callers are pinned to their own
 * branch and the body value is ignored; salon-wide roles keep what they sent.
 */
export const writableBranch = (req: Request, requested: unknown) =>
  isBranchLockedRole(req.user?.role)
    ? req.user?.branchId ?? "__no_branch__"
    : cleanText(requested);

export const validateBranch = async (
  salonId: string,
  branchId?: string | null
) => {
  if (!branchId) return true;
  return Boolean(
    await prisma.branch.findFirst({
      where: { id: branchId, salonId },
      select: { id: true },
    })
  );
};

export const cleanText = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

export const numberValue = (value: unknown) => Number(value);

export const productInclude = {
  brand: { select: { id: true, name: true } },
  vendor: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  salon: { select: { id: true, name: true } },
} as const;

export const transactionError = (message: string, status = 400) =>
  Object.assign(new Error(message), { status });

export const sendInventoryError = (
  res: import("express").Response,
  error: unknown
) => {
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
  return res.status(status).json({ success: false, message });
};
