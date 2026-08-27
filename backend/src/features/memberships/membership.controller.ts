import { type Request, type Response } from "express";
import { cleanText, getSalonId } from "../products/inventory-access.js";
import { MembershipModel } from "./membership.model.js";
import { prisma } from "../../config/prisma.js";
import { createAuditLog, requestAuditContext } from "../audit-logs/audit-log.service.js";

const safeMembership = (value: {
  id: string; name: string; discountPercentage: unknown; status: boolean;
  durationMonths?: number | null; price?: unknown; walletCreditAmount?: unknown;
}) => ({
  membershipId: value.id, name: value.name,
  discountPercentage: value.discountPercentage, status: value.status,
  durationMonths: value.durationMonths ?? null,
  price: value.price, walletCreditAmount: value.walletCreditAmount,
});

const membershipIdParam = (req: Request) =>
  typeof req.params.id === "string" ? req.params.id : "";

const accessSalonId = (req: Request) =>
  req.user?.role === "SUPER_ADMIN" ? undefined : req.user?.salonId;

const listSalonId = (req: Request) =>
  req.user?.role === "SUPER_ADMIN"
    ? typeof req.query.salonId === "string"
      ? req.query.salonId
      : undefined
    : req.user?.salonId;

const parseDiscountPercentage = (value: unknown) => {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && !value.trim())
  ) {
    return null;
  }

  const discountPercentage = Number(value);
  return Number.isFinite(discountPercentage) &&
    discountPercentage >= 0 &&
    discountPercentage <= 100
    ? discountPercentage
    : null;
};

/**
 * Validity of the plan in whole months. An explicit null (or empty string)
 * means the membership never expires, which is distinct from the field being
 * absent from the request. Returns `undefined` when absent and `false` when
 * the supplied value is not a usable duration.
 */
const parseDurationMonths = (value: unknown) => {
  if (value === undefined) return undefined;
  if (value === null || (typeof value === "string" && !value.trim())) {
    return null;
  }
  if (typeof value !== "number" && typeof value !== "string") return false;

  const durationMonths = Number(value);
  return Number.isInteger(durationMonths) &&
    durationMonths > 0 &&
    durationMonths <= 600
    ? durationMonths
    : false;
};

/** Non-negative money amount. Returns `false` when the value is unusable. */
const parseAmount = (value: unknown) => {
  if (value === undefined) return undefined;
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && !value.trim())
  ) {
    return false;
  }

  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 && amount <= 10_000_000
    ? amount
    : false;
};

const sendMembershipError = (res: Response, error: unknown) => {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  ) {
    return res.status(409).json({
      success: false,
      message: "Membership name already exists in this salon",
    });
  }

  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
};

export const createMembership = async (req: Request, res: Response) => {
  try {
    const salonId = getSalonId(req, req.body.salonId);
    const name = cleanText(req.body.name);
    const description = cleanText(req.body.description);
    const discountPercentage =
      req.body.discountPercentage === undefined
        ? 0
        : parseDiscountPercentage(req.body.discountPercentage);
    const durationMonths = parseDurationMonths(req.body.durationMonths);
    const price = parseAmount(req.body.price);
    const walletCreditAmount = parseAmount(req.body.walletCreditAmount);

    if (!salonId || !name) {
      return res.status(400).json({
        success: false,
        message: "Membership name and salon are required",
      });
    }

    if (discountPercentage === null) {
      return res.status(400).json({
        success: false,
        message: "Discount percentage must be between 0 and 100",
      });
    }

    if (durationMonths === false) {
      return res.status(400).json({
        success: false,
        message:
          "Duration must be a whole number of months between 1 and 600, or blank for no expiry",
      });
    }

    if (price === false || walletCreditAmount === false) {
      return res.status(400).json({
        success: false,
        message: "Price and wallet credit must be amounts of 0 or more",
      });
    }

    if (!(await MembershipModel.salonExists(salonId))) {
      return res.status(400).json({
        success: false,
        message: "Invalid salon",
      });
    }

    if (await MembershipModel.duplicate(salonId, name)) {
      return res.status(409).json({
        success: false,
        message: "Membership name already exists in this salon",
      });
    }

    const data = await prisma.$transaction(async (tx) => {
      const created = await MembershipModel.create({
        salonId, name, discountPercentage,
        ...(description ? { description } : {}),
        ...(durationMonths !== undefined ? { durationMonths } : {}),
        ...(price !== undefined ? { price } : {}),
        ...(walletCreditAmount !== undefined ? { walletCreditAmount } : {}),
      }, tx);
      await createAuditLog({ tx, salonId, userId: req.user?.userId, module: "MEMBERSHIP", action: "CREATE",
        entityId: created.id, entityName: created.name,
        description: `Admin created ${created.name} membership with ${Number(created.discountPercentage)}% discount`,
        newData: safeMembership(created), ...requestAuditContext(req) });
      return created;
    });

    return res.status(201).json({
      success: true,
      message: "Membership created successfully",
      data,
    });
  } catch (error) {
    return sendMembershipError(res, error);
  }
};

export const getMemberships = async (req: Request, res: Response) => {
  try {
    const salonId = listSalonId(req);

    if (req.user?.role !== "SUPER_ADMIN" && !salonId) {
      return res.status(400).json({
        success: false,
        message: "Salon ID is missing",
      });
    }

    const data = await MembershipModel.list(salonId);
    return res.status(200).json({
      success: true,
      message: "Memberships fetched successfully",
      data,
    });
  } catch (error) {
    return sendMembershipError(res, error);
  }
};

export const getMembership = async (req: Request, res: Response) => {
  try {
    const data = await MembershipModel.find(
      membershipIdParam(req),
      accessSalonId(req)
    );

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Membership not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Membership fetched successfully",
      data,
    });
  } catch (error) {
    return sendMembershipError(res, error);
  }
};

export const updateMembership = async (req: Request, res: Response) => {
  try {
    const existing = await MembershipModel.find(
      membershipIdParam(req),
      accessSalonId(req)
    );

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Membership not found",
      });
    }

    const name =
      req.body.name === undefined ? undefined : cleanText(req.body.name);
    const description =
      req.body.description === undefined
        ? undefined
        : cleanText(req.body.description) ?? null;
    const discountPercentage =
      req.body.discountPercentage === undefined
        ? undefined
        : parseDiscountPercentage(req.body.discountPercentage);
    const durationMonths = parseDurationMonths(req.body.durationMonths);
    const price = parseAmount(req.body.price);
    const walletCreditAmount = parseAmount(req.body.walletCreditAmount);

    if (req.body.name !== undefined && !name) {
      return res.status(400).json({
        success: false,
        message: "Membership name is required",
      });
    }

    if (discountPercentage === null) {
      return res.status(400).json({
        success: false,
        message: "Discount percentage must be between 0 and 100",
      });
    }

    if (durationMonths === false) {
      return res.status(400).json({
        success: false,
        message:
          "Duration must be a whole number of months between 1 and 600, or blank for no expiry",
      });
    }

    if (price === false || walletCreditAmount === false) {
      return res.status(400).json({
        success: false,
        message: "Price and wallet credit must be amounts of 0 or more",
      });
    }

    if (
      name &&
      (await MembershipModel.duplicate(existing.salonId, name, existing.id))
    ) {
      return res.status(409).json({
        success: false,
        message: "Membership name already exists in this salon",
      });
    }

    const data = await prisma.$transaction(async (tx) => {
      const updated = await MembershipModel.update(existing.id, {
      ...(name ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(discountPercentage !== undefined ? { discountPercentage } : {}),
      ...(durationMonths !== undefined ? { durationMonths } : {}),
      ...(price !== undefined ? { price } : {}),
      ...(walletCreditAmount !== undefined ? { walletCreditAmount } : {}),
      }, tx);
      await createAuditLog({ tx, salonId: existing.salonId, userId: req.user?.userId, module: "MEMBERSHIP", action: "UPDATE",
        entityId: existing.id, entityName: updated.name, description: `Admin updated ${updated.name} membership`,
        oldData: safeMembership(existing), newData: safeMembership(updated), ...requestAuditContext(req) });
      return updated;
    });

    return res.status(200).json({
      success: true,
      message: "Membership updated successfully",
      data,
    });
  } catch (error) {
    return sendMembershipError(res, error);
  }
};

export const setMembershipStatus = async (req: Request, res: Response) => {
  try {
    if (typeof req.body.status !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Status must be true or false",
      });
    }

    const existing = await MembershipModel.find(
      membershipIdParam(req),
      accessSalonId(req)
    );

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Membership not found",
      });
    }

    const data = await prisma.$transaction(async (tx) => {
      const updated = await MembershipModel.update(existing.id, { status: req.body.status }, tx);
      await createAuditLog({ tx, salonId: existing.salonId, userId: req.user?.userId, module: "MEMBERSHIP", action: "STATUS_CHANGE",
        entityId: existing.id, entityName: existing.name,
        description: `Admin ${req.body.status ? "activated" : "deactivated"} ${existing.name} membership`,
        oldData: { status: existing.status }, newData: { status: updated.status }, ...requestAuditContext(req) });
      return updated;
    });

    return res.status(200).json({
      success: true,
      message: "Membership status updated successfully",
      data,
    });
  } catch (error) {
    return sendMembershipError(res, error);
  }
};

export const deleteMembership = async (req: Request, res: Response) => {
  try {
    const existing = await MembershipModel.find(
      membershipIdParam(req),
      accessSalonId(req)
    );

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Membership not found",
      });
    }

    const hasCustomerHistory = await MembershipModel.hasCustomerHistory(
      existing.id
    );
    if (
      existing._count.customers > 0 ||
      existing._count.customerMemberships > 0 ||
      hasCustomerHistory
    ) {
      const data = await prisma.$transaction(async (tx) => {
        const updated = await MembershipModel.update(existing.id, { status: false }, tx);
        await createAuditLog({ tx, salonId: existing.salonId, userId: req.user?.userId, module: "MEMBERSHIP", action: "DELETE",
          entityId: existing.id, entityName: existing.name, description: `Admin soft-deleted ${existing.name} membership`,
          oldData: safeMembership(existing), newData: { ...safeMembership(updated), status: false }, ...requestAuditContext(req) });
        return updated;
      });

      return res.status(200).json({
        success: true,
        message: "Membership deactivated because customers are linked",
        data,
      });
    }

    await prisma.$transaction(async (tx) => {
      await MembershipModel.remove(existing.id, tx);
      await createAuditLog({ tx, salonId: existing.salonId, userId: req.user?.userId, module: "MEMBERSHIP", action: "DELETE",
        entityId: existing.id, entityName: existing.name, description: `Admin deleted ${existing.name} membership`,
        oldData: safeMembership(existing), ...requestAuditContext(req) });
    });
    return res.status(200).json({
      success: true,
      message: "Membership deleted successfully",
    });
  } catch (error) {
    return sendMembershipError(res, error);
  }
};
