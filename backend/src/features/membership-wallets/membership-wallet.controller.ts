import { type Request, type Response } from "express";
import { z } from "zod";
import { requestAuditContext } from "../audit-logs/audit-log.service.js";
import {
  CustomerMembershipError,
  type CustomerMembershipActor,
} from "../customer-memberships/customer-membership.service.js";
import {
  adjustMembershipWallet,
  getCustomerWalletSummary,
  getMembershipWallet,
  listMembershipWalletTransactions,
  payInvoiceFromMembershipWallet,
  topUpMembershipWallet,
} from "./membership-wallet.service.js";

const uuid = z.string().uuid();

const amountSchema = z
  .number()
  .positive("Amount must be greater than zero")
  .max(10_000_000, "Amount is too large");

const topUpSchema = z.object({
  amount: z.preprocess((value) => Number(value), amountSchema),
  narration: z.string().trim().max(500).optional(),
});

const adjustSchema = z.object({
  amount: z.preprocess((value) => Number(value), amountSchema),
  direction: z.enum(["CREDIT", "DEBIT"]),
  narration: z.string().trim().max(500).optional(),
});

const paySchema = z.object({
  invoiceId: uuid,
  // Omit to settle the whole outstanding balance.
  amount: z
    .preprocess((value) => (value === undefined ? undefined : Number(value)), amountSchema)
    .optional(),
  // Omit to draw from the spendable memberships of the customer in expiry order.
  customerMembershipId: uuid.optional(),
  note: z.string().trim().max(500).optional(),
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
  customerMembershipId: uuid.optional(),
  type: z
    .enum([
      "PURCHASE_CREDIT",
      "TOPUP",
      "SPEND",
      "REFUND",
      "FORFEIT",
      "ADJUSTMENT",
    ])
    .optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
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
      message: error.issues[0]?.message ?? "Invalid membership wallet request",
      errors: error.issues,
    });
  }
  console.error(error);
  return res.status(500).json({
    success: false,
    message: "Unable to process membership wallet request",
  });
};

export const getWallet = async (req: Request, res: Response) => {
  try {
    return res.json({
      success: true,
      data: await getMembershipWallet(actorFrom(req), param(req, "id")),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getWalletTransactions = async (req: Request, res: Response) => {
  try {
    const filters = listSchema.parse(req.query);
    return res.json({
      success: true,
      ...(await listMembershipWalletTransactions(actorFrom(req), {
        page: filters.page,
        limit: filters.limit,
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
        ...(filters.customerMembershipId
          ? { customerMembershipId: filters.customerMembershipId }
          : {}),
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.startDate ? { startDate: filters.startDate } : {}),
        ...(filters.endDate ? { endDate: filters.endDate } : {}),
      })),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const postWalletTopUp = async (req: Request, res: Response) => {
  try {
    const input = topUpSchema.parse(req.body);
    const result = await topUpMembershipWallet(
      actorFrom(req),
      param(req, "id"),
      {
        amount: input.amount,
        ...(input.narration ? { narration: input.narration } : {}),
      },
      requestAuditContext(req)
    );
    return res.status(201).json({
      success: true,
      message: "Membership wallet topped up successfully",
      data: result,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const postWalletAdjustment = async (req: Request, res: Response) => {
  try {
    const input = adjustSchema.parse(req.body);
    const result = await adjustMembershipWallet(
      actorFrom(req),
      param(req, "id"),
      {
        amount: input.amount,
        direction: input.direction,
        ...(input.narration ? { narration: input.narration } : {}),
      },
      requestAuditContext(req)
    );
    return res.status(201).json({
      success: true,
      message: "Membership wallet adjusted successfully",
      data: result,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const postWalletInvoicePayment = async (
  req: Request,
  res: Response
) => {
  try {
    const input = paySchema.parse(req.body);
    const result = await payInvoiceFromMembershipWallet(
      actorFrom(req),
      {
        invoiceId: input.invoiceId,
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.customerMembershipId
          ? { customerMembershipId: input.customerMembershipId }
          : {}),
        ...(input.note ? { note: input.note } : {}),
      },
      requestAuditContext(req)
    );
    return res.status(201).json({
      success: true,
      message: "Invoice paid from membership wallet",
      data: result,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getCustomerWallet = async (req: Request, res: Response) => {
  try {
    return res.json({
      success: true,
      data: await getCustomerWalletSummary(
        actorFrom(req),
        param(req, "customerId")
      ),
    });
  } catch (error) {
    return sendError(res, error);
  }
};
