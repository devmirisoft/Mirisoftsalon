import { prisma } from "../../config/prisma.js";
import { Prisma, type PaymentMethod } from "../../generated/prisma/client.js";
import { createAuditLog } from "../audit-logs/audit-log.service.js";
import { awardInvoiceLoyaltyInTransaction } from "../Invoices/invoice-retention.service.js";
import {
  getSpendableWalletForCustomer,
  spendFromMembershipWallet,
} from "../membership-wallets/membership-wallet.service.js";
import type { CustomerMembershipActor } from "../customer-memberships/customer-membership.service.js";

type TransactionClient = Prisma.TransactionClient;

const zero = new Prisma.Decimal(0);

export class SettleInvoiceError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "SettleInvoiceError";
  }
}

export type SettleInvoiceInput = {
  method: PaymentMethod;
  /** Omit to settle the whole outstanding balance. */
  amount?: number | Prisma.Decimal | undefined;
  referenceNo?: string | undefined;
  note?: string | undefined;
  paidAt?: Date | undefined;
  /** MEMBERSHIP_WALLET only: draw from one membership instead of by expiry. */
  customerMembershipId?: string | undefined;
  jobCartAppointmentId?: string | undefined;
};

/**
 * Records one payment against an already-issued invoice inside a caller's
 * transaction: the Payment row, the invoice totals, the customer ledger, the
 * membership-wallet debit when paid from a wallet, and the loyalty award once
 * the bill is fully settled.
 *
 * Callers that own no transaction should use `settleInvoice`, and callers
 * that already hold the invoice row locked (job cart confirm, wallet pay)
 * pass their own `tx` so a failure anywhere rolls the whole bill back.
 */
export const settleInvoiceInTransaction = async (
  tx: TransactionClient,
  actor: CustomerMembershipActor,
  invoiceId: string,
  input: SettleInvoiceInput,
  audit: { ipAddress?: string | undefined; userAgent?: string | undefined } = {}
) => {
  const invoice = await tx.invoice.findFirst({
    where: {
      id: invoiceId,
      ...(actor.role === "SUPER_ADMIN"
        ? {}
        : { salonId: actor.salonId ?? "__unauthorized__" }),
    },
  });
  if (!invoice) {
    throw new SettleInvoiceError(404, "Invoice not found");
  }
  if (invoice.status === "CANCELLED") {
    throw new SettleInvoiceError(
      409,
      "Cannot add payment to cancelled invoice"
    );
  }
  if (invoice.status === "DRAFT") {
    throw new SettleInvoiceError(
      409,
      "Draft invoice must be issued before payment"
    );
  }
  if (invoice.paymentStatus === "PAID") {
    throw new SettleInvoiceError(409, "Invoice is already fully paid");
  }
  if (invoice.appointmentId) {
    const appointment = await tx.appointment.findUnique({
      where: { id: invoice.appointmentId },
      select: { status: true },
    });
    if (appointment?.status === "CANCELLED") {
      throw new SettleInvoiceError(
        409,
        "Cannot add payment to a cancelled appointment or job cart"
      );
    }
  }

  const now = input.paidAt ?? new Date();
  const requested =
    input.amount === undefined
      ? invoice.balanceAmount
      : new Prisma.Decimal(input.amount).toDecimalPlaces(2);
  if (requested.lte(zero)) {
    throw new SettleInvoiceError(400, "Amount must be greater than 0");
  }
  if (requested.gt(invoice.balanceAmount)) {
    throw new SettleInvoiceError(
      400,
      "Payment amount cannot be greater than invoice balance"
    );
  }

  // A wallet payment is only allowed once the funds are proven present, so
  // the Payment row is never written against a wallet that cannot cover it.
  const walletSources =
    input.method === "MEMBERSHIP_WALLET"
      ? (
          await getSpendableWalletForCustomer(
            tx,
            actor,
            invoice.customerId,
            now
          )
        ).memberships.filter(
          (row) =>
            !input.customerMembershipId ||
            row.id === input.customerMembershipId
        )
      : [];
  if (input.method === "MEMBERSHIP_WALLET") {
    const available = walletSources.reduce(
      (sum, row) => sum.plus(row.walletBalance),
      zero
    );
    if (available.lt(requested)) {
      throw new SettleInvoiceError(
        400,
        "Insufficient membership wallet balance"
      );
    }
  }

  const payment = await tx.payment.create({
    data: {
      salonId: invoice.salonId,
      ...(invoice.branchId ? { branchId: invoice.branchId } : {}),
      customerId: invoice.customerId,
      invoiceId: invoice.id,
      amount: requested,
      method: input.method,
      ...(input.referenceNo ? { referenceNo: input.referenceNo } : {}),
      ...(input.note ? { note: input.note } : {}),
      ...(input.paidAt ? { paidAt: input.paidAt } : {}),
    },
  });

  const movements = [];
  let remaining = requested;
  for (const source of walletSources) {
    if (remaining.lte(zero)) break;
    const take = Prisma.Decimal.min(remaining, source.walletBalance);
    if (take.lte(zero)) continue;
    const movement = await spendFromMembershipWallet(tx, {
      actor,
      customerMembershipId: source.id,
      amount: take,
      narration: `Paid invoice ${invoice.invoiceCode} from membership wallet`,
      invoiceId: invoice.id,
      paymentId: payment.id,
      ...(input.jobCartAppointmentId
        ? { jobCartAppointmentId: input.jobCartAppointmentId }
        : {}),
      now,
    });
    if (movement) movements.push(movement);
    remaining = remaining.minus(take);
  }

  const paidAmount = invoice.paidAmount.plus(requested).toDecimalPlaces(2);
  const balanceAmount = invoice.totalAmount
    .minus(paidAmount)
    .toDecimalPlaces(2);
  const paymentStatus = balanceAmount.lte(zero) ? "PAID" : "PARTIALLY_PAID";

  const updatedInvoice = await tx.invoice.update({
    where: { id: invoice.id },
    data: { paidAmount, balanceAmount, paymentStatus },
  });

  const customer = await tx.customer.update({
    where: { id: invoice.customerId },
    data: { outstandingAmount: { decrement: requested } },
  });

  await tx.customerTransaction.create({
    data: {
      customerId: invoice.customerId,
      salonId: invoice.salonId,
      invoiceId: invoice.id,
      paymentId: payment.id,
      billNo: invoice.invoiceCode,
      narration:
        input.method === "MEMBERSHIP_WALLET"
          ? "Payment received from membership wallet"
          : `Payment received via ${input.method}`,
      type: "PAYMENT",
      debit: 0,
      credit: requested,
      balanceAfter: customer.outstandingAmount,
      status: "COMPLETE",
    },
  });

  const loyalty =
    paymentStatus === "PAID"
      ? await awardInvoiceLoyaltyInTransaction(tx, {
          invoiceId: invoice.id,
          salonId: invoice.salonId,
          customerId: invoice.customerId,
          finalPaidAmount: Number(paidAmount),
          ...(actor.userId ? { createdById: actor.userId } : {}),
        })
      : null;

  await createAuditLog({
    tx,
    salonId: invoice.salonId,
    branchId: invoice.branchId,
    userId: actor.userId,
    module: "PAYMENT",
    action: "PAYMENT_RECORDED",
    entityId: payment.id,
    entityCode: invoice.invoiceCode,
    entityName: invoice.customerName,
    description: `Payment recorded for invoice ${invoice.invoiceCode}`,
    oldData: {
      paidAmount: invoice.paidAmount,
      balanceAmount: invoice.balanceAmount,
      paymentStatus: invoice.paymentStatus,
    },
    newData: {
      amount: requested,
      method: input.method,
      paidAmount,
      balanceAmount,
      paymentStatus,
      ...(movements.length
        ? {
            walletSources: movements.map((movement) => ({
              customerMembershipId: movement.ledger.customerMembershipId,
              debit: movement.ledger.debit,
              balanceAfter: movement.balanceAfter,
            })),
          }
        : {}),
    },
    ...audit,
  });

  return { payment, invoice: updatedInvoice, movements, loyalty };
};

/** Same as `settleInvoiceInTransaction`, for callers without a transaction. */
export const settleInvoice = async (
  actor: CustomerMembershipActor,
  invoiceId: string,
  input: SettleInvoiceInput,
  audit: { ipAddress?: string | undefined; userAgent?: string | undefined } = {}
) =>
  prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
    return settleInvoiceInTransaction(tx, actor, invoiceId, input, audit);
  });
