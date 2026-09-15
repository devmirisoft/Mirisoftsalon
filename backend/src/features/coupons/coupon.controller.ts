import { type Request, type Response } from "express";
import {
  actorBranchOrSalonWideWhere,
  isBranchPinned,
  pinnedBranchId,
} from "../../utils/branch-scope.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { isUuid } from "../../middlewares/uuid.middleware.js";
import { paginationMeta, parsePagination } from "../../utils/pagination.js";
import {
  createAuditLog,
  requestAuditContext,
} from "../audit-logs/audit-log.service.js";
import { CouponModel } from "./coupon.model.js";
import {
  CouponServiceError,
  createCoupon,
  deleteCoupon,
  setCouponStatus,
  updateCoupon,
} from "./coupon.service.js";
import {
  couponStatusSchema,
  createCouponSchema,
  updateCouponSchema,
} from "./coupon.validation.js";

const idParam = (req: Request) =>
  typeof req.params.id === "string" ? req.params.id : "";

const accessWhere = (
  req: Request,
  id?: string
): Prisma.CouponWhereInput => ({
  ...(id ? { id } : {}),
  ...(req.user?.role === "SUPER_ADMIN"
    ? typeof req.query.salonId === "string"
      ? { salonId: req.query.salonId }
      : {}
    : { salonId: req.user?.salonId ?? "__missing__" }),
  ...actorBranchOrSalonWideWhere(req.user ?? {}),
});

const sendError = (res: Response, error: unknown) => {
  if (error instanceof CouponServiceError) {
    return res.status(error.status).json({
      success: false,
      message: error.message,
    });
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  ) {
    return res.status(409).json({
      success: false,
      message: "Coupon code already exists in this salon",
    });
  }
  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
};

const validationError = (res: Response, parsed: { error: { issues: Array<{ message: string }> } }) =>
  res.status(400).json({
    success: false,
    message: parsed.error.issues[0]?.message ?? "Invalid coupon data",
  });

const booleanQuery = (value: unknown) => {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
};

const dateQuery = (value: unknown, endOfDay = false) => {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
};

export const getCoupons = async (req: Request, res: Response) => {
  try {
    const pagination = parsePagination(req.query);
    if ("error" in pagination) {
      return res.status(400).json({
        success: false,
        message: pagination.error,
      });
    }
    const isActive = booleanQuery(req.query.isActive);
    const validNow = booleanQuery(req.query.validNow);
    if (isActive === null || validNow === null) {
      return res.status(400).json({
        success: false,
        message: "Boolean filters must be true or false",
      });
    }
    const startDate = dateQuery(req.query.startDate);
    const endDate = dateQuery(req.query.endDate, true);
    if (startDate === null || endDate === null) {
      return res.status(400).json({
        success: false,
        message: "Invalid date filter",
      });
    }

    const conditions: Prisma.CouponWhereInput[] = [
      accessWhere(req),
      ...(isActive !== undefined ? [{ isActive }] : []),
      ...(typeof req.query.branchId === "string" &&
      !["BRANCH_MANAGER", "RECEPTIONIST"].includes(req.user?.role ?? "")
        ? [{ branchId: req.query.branchId }]
        : []),
      ...(validNow
        ? [
            {
              isActive: true,
              validFrom: { lte: new Date() },
              validUntil: { gte: new Date() },
            },
          ]
        : []),
      ...(startDate ? [{ validUntil: { gte: startDate } }] : []),
      ...(endDate ? [{ validFrom: { lte: endDate } }] : []),
      ...(typeof req.query.search === "string" && req.query.search.trim()
        ? [
            {
              OR: [
                {
                  couponCode: {
                    contains: req.query.search.trim(),
                    mode: "insensitive" as const,
                  },
                },
                {
                  name: {
                    contains: req.query.search.trim(),
                    mode: "insensitive" as const,
                  },
                },
                {
                  description: {
                    contains: req.query.search.trim(),
                    mode: "insensitive" as const,
                  },
                },
              ],
            },
          ]
        : []),
    ];
    const where: Prisma.CouponWhereInput = { AND: conditions };

    const sortable = new Set([
      "couponCode",
      "name",
      "discountPercentage",
      "validFrom",
      "validUntil",
      "usedCount",
      "createdAt",
    ]);
    const sortBy =
      typeof req.query.sortBy === "string" &&
      sortable.has(req.query.sortBy)
        ? req.query.sortBy
        : "createdAt";
    const sortOrder = req.query.sortOrder === "asc" ? "asc" : "desc";
    const result = await CouponModel.list({
      where,
      skip: pagination.skip,
      take: pagination.limit,
      orderBy: { [sortBy]: sortOrder },
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: paginationMeta(
        pagination.page,
        pagination.limit,
        result.total
      ),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getCoupon = async (req: Request, res: Response) => {
  try {
    const coupon = await CouponModel.find(accessWhere(req, idParam(req)));
    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: "Coupon not found",
      });
    }
    return res.status(200).json({ success: true, data: coupon });
  } catch (error) {
    return sendError(res, error);
  }
};

export const createCouponHandler = async (
  req: Request,
  res: Response
) => {
  try {
    const parsed = createCouponSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);
    const salonId =
      req.user?.role === "SUPER_ADMIN"
        ? parsed.data.salonId
        : req.user?.salonId;
    if (!salonId || !isUuid(salonId)) {
      return res.status(400).json({
        success: false,
        message: "Valid salon ID is required",
      });
    }
    const pinnedBranch = pinnedBranchId(req.user);
    const data = await createCoupon(
      salonId,
      pinnedBranch ? { ...parsed.data, branchId: pinnedBranch } : parsed.data,
      {
        ...(req.user?.userId ? { userId: req.user.userId } : {}),
        ...requestAuditContext(req),
      }
    );
    return res.status(201).json({
      success: true,
      message: "Coupon created successfully",
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const updateCouponHandler = async (
  req: Request,
  res: Response
) => {
  try {
    const existing = await CouponModel.find(
      accessWhere(req, idParam(req))
    );
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Coupon not found",
      });
    }
    const parsed = updateCouponSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);
    // A pinned caller may edit a coupon they can see, but not move it out of
    // the branch they are working in.
    const { branchId: _requestedBranch, ...withoutBranch } = parsed.data;
    const data = await updateCoupon(
      existing,
      isBranchPinned(req.user) ? withoutBranch : parsed.data,
      {
        ...(req.user?.userId ? { userId: req.user.userId } : {}),
        ...requestAuditContext(req),
      }
    );
    return res.status(200).json({
      success: true,
      message: "Coupon updated successfully",
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const setCouponStatusHandler = async (
  req: Request,
  res: Response
) => {
  try {
    const existing = await CouponModel.find(
      accessWhere(req, idParam(req))
    );
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Coupon not found",
      });
    }
    const parsed = couponStatusSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);
    const data = await setCouponStatus(
      existing,
      parsed.data.isActive,
      {
        ...(req.user?.userId ? { userId: req.user.userId } : {}),
        ...requestAuditContext(req),
      }
    );
    return res.status(200).json({
      success: true,
      message: `Coupon ${
        data.isActive ? "activated" : "deactivated"
      } successfully`,
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const deleteCouponHandler = async (
  req: Request,
  res: Response
) => {
  try {
    const existing = await CouponModel.find(
      accessWhere(req, idParam(req))
    );
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Coupon not found",
      });
    }
    const result = await deleteCoupon(existing, {
      ...(req.user?.userId ? { userId: req.user.userId } : {}),
      ...requestAuditContext(req),
    });
    return res.status(200).json({
      success: true,
      message: result.softDeleted
        ? "Coupon deactivated because it has invoice usage"
        : "Coupon deleted successfully",
      data: result.coupon,
    });
  } catch (error) {
    return sendError(res, error);
  }
};
