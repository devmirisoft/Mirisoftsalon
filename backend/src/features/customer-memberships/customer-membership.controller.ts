import { type Request, type Response } from "express";
import { z } from "zod";
import { requestAuditContext } from "../audit-logs/audit-log.service.js";
import {
  assignCustomerMembershipHistory,
  CustomerMembershipError,
  endCustomerMembership,
  getCustomerMembershipById,
  getCustomerMembershipHistory,
  listCustomerMembershipHistory,
  type CustomerMembershipActor,
} from "./customer-membership.service.js";

const uuid = z.string().uuid();

// Selling a membership takes money in. MEMBERSHIP_WALLET is deliberately
// absent: you cannot buy a membership by redeeming another membership's
// wallet.
const SALE_PAYMENT_METHODS = [
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

export const assignmentSchema = z
  .object({
    membershipId: uuid,
    startsAt: z.coerce.date().optional(),
    expiresAt: z.coerce.date().nullable().optional(),
    // Overrides the wallet credit configured on the plan for this one sale.
    walletCreditAmount: z
      .preprocess(
        (value) => (value === undefined ? undefined : Number(value)),
        z.number().min(0).max(10_000_000)
      )
      .optional(),
    paymentMethod: z.enum(SALE_PAYMENT_METHODS).optional(),
    soldByStaffId: uuid.optional(),
    // An empty field means "not recorded", not zero, so it is normalised to
    // undefined inside the preprocess where .optional() can still see it.
    amountPaid: z.preprocess(
      (value) =>
        value === undefined || value === null || value === ""
          ? undefined
          : Number(value),
      z.number().min(0).max(10_000_000).optional()
    ),
    note: z.string().trim().max(2000).optional(),
  })
  .superRefine((value, context) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (value.startsAt && value.startsAt < today) {
      context.addIssue({
        code: "custom",
        path: ["startsAt"],
        message: "Membership start date cannot be in the past",
      });
    }
    if (value.expiresAt && value.expiresAt < today) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Membership expiry date cannot be in the past",
      });
    }
    if (value.startsAt && value.expiresAt && value.expiresAt < value.startsAt) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Membership expiry must be on or after its start date",
      });
    }
  });

const positiveInteger = (fallback: number, maximum: number) =>
  z.preprocess(
    (value) => (value === undefined ? fallback : Number(value)),
    z.number().int().min(1).max(maximum)
  );

const listSchema = z.object({
  page: positiveInteger(1, 1_000_000),
  limit: positiveInteger(20, 100),
  customerId: uuid.optional(),
  membershipId: uuid.optional(),
  status: z
    .enum(["ACTIVE", "EXPIRED", "CANCELLED", "REMOVED"])
    .optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  search: z.string().trim().max(120).optional(),
});

const actorFrom = (req: Request): CustomerMembershipActor => {
  if (!req.user?.userId) {
    throw new CustomerMembershipError(401, "Unauthorized");
  }
  return {
    userId: req.user.userId,
    role: req.user.role,
    ...(req.user.salonId ? { salonId: req.user.salonId } : {}),
    ...(req.user.branchId ? { branchId: req.user.branchId } : {}),
  };
};

const param = (req: Request, key: string) => {
  const value = req.params[key];
  return typeof value === "string" ? value : "";
};

const sendError = (res: Response, error: unknown) => {
  if (error instanceof CustomerMembershipError) {
    return res
      .status(error.status)
      .json({ success: false, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      success: false,
      message:
        error.issues[0]?.message ?? "Invalid customer membership request",
      errors: error.issues,
    });
  }
  console.error(error);
  return res.status(500).json({
    success: false,
    message: "Unable to process customer membership request",
  });
};

export const getCustomerMemberships = async (
  req: Request,
  res: Response
) => {
  try {
    return res.json({
      success: true,
      data: await getCustomerMembershipHistory(
        actorFrom(req),
        param(req, "customerId"),
        requestAuditContext(req)
      ),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const postCustomerMembership = async (
  req: Request,
  res: Response
) => {
  try {
    const input = assignmentSchema.parse(req.body);
    const data = await assignCustomerMembershipHistory(
      actorFrom(req),
      param(req, "customerId"),
      {
        membershipId: input.membershipId,
        ...(input.startsAt ? { startsAt: input.startsAt } : {}),
        ...(input.expiresAt !== undefined
          ? { expiresAt: input.expiresAt }
          : {}),
        ...(input.walletCreditAmount !== undefined
          ? { walletCreditAmount: input.walletCreditAmount }
          : {}),
        ...(input.paymentMethod
          ? { paymentMethod: input.paymentMethod }
          : {}),
        ...(input.amountPaid !== undefined
          ? { amountPaid: input.amountPaid }
          : {}),
        ...(input.soldByStaffId
          ? { soldByStaffId: input.soldByStaffId }
          : {}),
        ...(input.note ? { note: input.note } : {}),
      },
      requestAuditContext(req)
    );
    return res.status(201).json({
      success: true,
      message: "Customer membership assigned successfully",
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getAllCustomerMemberships = async (
  req: Request,
  res: Response
) => {
  try {
    const filters = listSchema.parse(req.query);
    return res.json({
      success: true,
      ...(await listCustomerMembershipHistory(
        actorFrom(req),
        {
          page: filters.page,
          limit: filters.limit,
          ...(filters.customerId
            ? { customerId: filters.customerId }
            : {}),
          ...(filters.membershipId
            ? { membershipId: filters.membershipId }
            : {}),
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.startDate ? { startDate: filters.startDate } : {}),
          ...(filters.endDate ? { endDate: filters.endDate } : {}),
          ...(filters.search ? { search: filters.search } : {}),
        },
        requestAuditContext(req)
      )),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getCustomerMembership = async (
  req: Request,
  res: Response
) => {
  try {
    return res.json({
      success: true,
      data: await getCustomerMembershipById(
        actorFrom(req),
        param(req, "id"),
        requestAuditContext(req)
      ),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

const end = (status: "CANCELLED" | "REMOVED" | "EXPIRED") =>
  async (req: Request, res: Response) => {
    try {
      return res.json({
        success: true,
        message: `Customer membership marked ${status.toLowerCase()}`,
        data: await endCustomerMembership(
          actorFrom(req),
          param(req, "id"),
          status,
          requestAuditContext(req)
        ),
      });
    } catch (error) {
      return sendError(res, error);
    }
  };

export const cancelCustomerMembership = end("CANCELLED");
export const removeCustomerMembership = end("REMOVED");
export const expireCustomerMembership = end("EXPIRED");
