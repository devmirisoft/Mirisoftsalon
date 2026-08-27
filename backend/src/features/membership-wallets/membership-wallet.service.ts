import { prisma } from "../../config/prisma.js";
import {
  Prisma,
  type MembershipWalletTransactionType,
} from "../../generated/prisma/client.js";
import { createAuditLog } from "../audit-logs/audit-log.service.js";
import {
  CustomerMembershipError,
  type CustomerMembershipActor,
} from "../customer-memberships/customer-membership.service.js";

type TransactionClient = Prisma.TransactionClient;
type AuditContext = { ipAddress?: string; userAgent?: string };

const branchScopedRoles = new Set(["BRANCH_MANAGER", "RECEPTIONIST"]);

const zero = new Prisma.Decimal(0);

const walletScope = (
  actor: CustomerMembershipActor
): Prisma.CustomerMembershipWhereInput => {
  if (actor.role === "SUPER_ADMIN") return {};
  if (!actor.salonId) return { salonId: "__unauthorized__" };
  return {
    salonId: actor.salonId,
    ...(branchScopedRoles.has(actor.role)
      ? { branchId: actor.branchId ?? "__unauthorized__" }
      : {}),
  };
};

const ledgerScope = (
  actor: CustomerMembershipActor
): Prisma.MembershipWalletTransactionWhereInput => {
  if (actor.role === "SUPER_ADMIN") return {};
  if (!actor.salonId) return { salonId: "__unauthorized__" };
  return {
    salonId: actor.salonId,
    ...(branchScopedRoles.has(actor.role)
      ? { branchId: actor.branchId ?? "__unauthorized__" }
      : {}),
  };
};

const toDecimal = (value: Prisma.Decimal | number | string) =>
  value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);

type WalletBearingMembership = {
  id: string;
  salonId: string;
  branchId: string | null;
  customerId: string;
  membershipNameSnapshot: string;
  walletCredited: Prisma.Decimal;
  walletDebited: Prisma.Decimal;
  walletBalance: Prisma.Decimal;
};

/**
 * Locks a membership row and returns it, enforcing the scope of the actor.
 * Every balance mutation goes through here so concurrent spends on the same
 * wallet serialize instead of racing on a stale balance.
 */
const lockMembership = async (
  tx: TransactionClient,
  actor: CustomerMembershipActor,
  customerMembershipId: string
) => {
  const scoped = await tx.customerMembership.findFirst({
    where: { id: customerMembershipId, ...walletScope(actor) },
    include: {
      customer: {
        select: { id: true, customerCode: true, name: true },
      },
    },
  });
  if (!scoped) {
    throw new CustomerMembershipError(404, "Customer membership not found");
  }
  await tx.$queryRaw`SELECT "id" FROM "CustomerMembership" WHERE "id" = ${scoped.id} FOR UPDATE`;
  const locked = await tx.customerMembership.findUnique({
    where: { id: scoped.id },
  });
  if (!locked) {
    throw new CustomerMembershipError(404, "Customer membership not found");
  }
  return { ...locked, customer: scoped.customer };
};

const isSpendable = (
  membership: { status: string; startsAt: Date; expiresAt: Date | null },
  now: Date
) =>
  membership.status === "ACTIVE" &&
  membership.startsAt <= now &&
  (membership.expiresAt === null || membership.expiresAt >= now);

/**
 * Applies a single ledger movement to a locked membership wallet and writes
 * the matching MembershipWalletTransaction row. `amount` is always positive;
 * `direction` decides which column it lands in.
 */
export const applyWalletMovement = async (
  tx: TransactionClient,
  input: {
    membership: WalletBearingMembership;
    amount: Prisma.Decimal | number | string;
    direction: "CREDIT" | "DEBIT";
    type: MembershipWalletTransactionType;
    narration?: string;
    invoiceId?: string;
    paymentId?: string;
    jobCartAppointmentId?: string;
    createdById?: string;
  }
) => {
  const amount = toDecimal(input.amount).toDecimalPlaces(2);
  if (amount.lte(zero)) {
    throw new CustomerMembershipError(400, "Amount must be greater than zero");
  }

  const credit = input.direction === "CREDIT" ? amount : zero;
  const debit = input.direction === "DEBIT" ? amount : zero;
  const balanceAfter = input.membership.walletBalance
    .plus(credit)
    .minus(debit)
    .toDecimalPlaces(2);

  if (balanceAfter.lt(zero)) {
    throw new CustomerMembershipError(
      400,
      "Insufficient membership wallet balance"
    );
  }

  const updated = await tx.customerMembership.update({
    where: { id: input.membership.id },
    data: {
      walletCredited: input.membership.walletCredited.plus(credit),
      walletDebited: input.membership.walletDebited.plus(debit),
      walletBalance: balanceAfter,
    },
  });

  const ledger = await tx.membershipWalletTransaction.create({
    data: {
      salonId: input.membership.salonId,
      branchId: input.membership.branchId,
      customerId: input.membership.customerId,
      customerMembershipId: input.membership.id,
      type: input.type,
      credit,
      debit,
      balanceAfter,
      ...(input.narration ? { narration: input.narration } : {}),
      ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
      ...(input.paymentId ? { paymentId: input.paymentId } : {}),
      ...(input.jobCartAppointmentId
        ? { jobCartAppointmentId: input.jobCartAppointmentId }
        : {}),
      ...(input.createdById ? { createdById: input.createdById } : {}),
    },
  });

  return { membership: updated, ledger, balanceAfter };
};

/**
 * Credits the wallet at purchase time. Called from the membership assignment
 * flow, inside its transaction, with the freshly created row.
 */
export const creditPurchaseWallet = async (
  tx: TransactionClient,
  input: {
    membership: WalletBearingMembership;
    amount: Prisma.Decimal | number | string;
    createdById?: string;
    invoiceId?: string;
    jobCartAppointmentId?: string;
  }
) => {
  const amount = toDecimal(input.amount).toDecimalPlaces(2);
  if (amount.lte(zero)) return null;
  return applyWalletMovement(tx, {
    membership: input.membership,
    amount,
    direction: "CREDIT",
    type: "PURCHASE_CREDIT",
    narration: `Wallet credit on ${input.membership.membershipNameSnapshot} purchase`,
    ...(input.createdById ? { createdById: input.createdById } : {}),
    ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
    ...(input.jobCartAppointmentId
      ? { jobCartAppointmentId: input.jobCartAppointmentId }
      : {}),
  });
};

/** Adds funds to an active membership wallet. */
export const topUpMembershipWallet = async (
  actor: CustomerMembershipActor,
  customerMembershipId: string,
  input: { amount: number; narration?: string },
  audit: AuditContext
) =>
  prisma.$transaction(async (tx) => {
    const membership = await lockMembership(tx, actor, customerMembershipId);
    const now = new Date();
    if (!isSpendable(membership, now)) {
      throw new CustomerMembershipError(
        409,
        "Wallet can only be topped up on an active membership"
      );
    }

    const result = await applyWalletMovement(tx, {
      membership,
      amount: input.amount,
      direction: "CREDIT",
      type: "TOPUP",
      narration: input.narration ?? "Membership wallet top-up",
      createdById: actor.userId,
    });

    await createAuditLog({
      tx,
      salonId: membership.salonId,
      branchId: membership.branchId,
      userId: actor.userId,
      module: "MEMBERSHIP",
      action: "UPDATE",
      entityId: membership.id,
      entityCode: membership.customer.customerCode,
      entityName: membership.customer.name,
      description: `Membership wallet topped up by ${input.amount}`,
      oldData: { walletBalance: membership.walletBalance },
      newData: { walletBalance: result.balanceAfter },
      ...audit,
    });

    return result;
  });

/** Manual correction in either direction, admin only at the route layer. */
export const adjustMembershipWallet = async (
  actor: CustomerMembershipActor,
  customerMembershipId: string,
  input: { amount: number; direction: "CREDIT" | "DEBIT"; narration?: string },
  audit: AuditContext
) =>
  prisma.$transaction(async (tx) => {
    const membership = await lockMembership(tx, actor, customerMembershipId);

    const result = await applyWalletMovement(tx, {
      membership,
      amount: input.amount,
      direction: input.direction,
      type: "ADJUSTMENT",
      narration: input.narration ?? "Manual wallet adjustment",
      createdById: actor.userId,
    });

    await createAuditLog({
      tx,
      salonId: membership.salonId,
      branchId: membership.branchId,
      userId: actor.userId,
      module: "MEMBERSHIP",
      action: "UPDATE",
      entityId: membership.id,
      entityCode: membership.customer.customerCode,
      entityName: membership.customer.name,
      description: `Membership wallet adjusted ${input.direction === "CREDIT" ? "+" : "-"}${input.amount}`,
      oldData: { walletBalance: membership.walletBalance },
      newData: { walletBalance: result.balanceAfter },
      ...audit,
    });

    return result;
  });

/**
 * Spends from the wallet toward a bill. Returns the movement actually applied,
 * capped at the lesser of the request and the balance when partial spend is
 * allowed. Safe to call inside the transaction of a caller (billing, job cart).
 */
export const spendFromMembershipWallet = async (
  tx: TransactionClient,
  input: {
    actor: CustomerMembershipActor;
    customerMembershipId: string;
    amount: Prisma.Decimal | number | string;
    narration?: string;
    invoiceId?: string;
    paymentId?: string;
    jobCartAppointmentId?: string;
    allowPartial?: boolean;
    now?: Date;
  }
) => {
  const membership = await lockMembership(
    tx,
    input.actor,
    input.customerMembershipId
  );
  const now = input.now ?? new Date();
  if (!isSpendable(membership, now)) {
    throw new CustomerMembershipError(
      409,
      "Membership is not active, its wallet cannot be used"
    );
  }

  const requested = toDecimal(input.amount).toDecimalPlaces(2);
  if (requested.lte(zero)) return null;

  const spend = input.allowPartial
    ? Prisma.Decimal.min(requested, membership.walletBalance)
    : requested;
  if (spend.lte(zero)) return null;
  if (spend.gt(membership.walletBalance)) {
    throw new CustomerMembershipError(
      400,
      "Insufficient membership wallet balance"
    );
  }

  return applyWalletMovement(tx, {
    membership,
    amount: spend,
    direction: "DEBIT",
    type: "SPEND",
    narration: input.narration ?? "Paid from membership wallet",
    createdById: input.actor.userId,
    ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
    ...(input.paymentId ? { paymentId: input.paymentId } : {}),
    ...(input.jobCartAppointmentId
      ? { jobCartAppointmentId: input.jobCartAppointmentId }
      : {}),
  });
};

/**
 * Settles part or all of an invoice from a membership wallet. The wallet
 * debit, the Payment row, the invoice totals and the customer ledger all move
 * in one transaction, so a failure anywhere leaves the wallet untouched.
 *
 * When `customerMembershipId` is omitted the spendable memberships of the
 * customer are drawn down in expiry order, so funds that lapse soonest are
 * used first.
 */
export const payInvoiceFromMembershipWallet = async (
  actor: CustomerMembershipActor,
  input: {
    invoiceId: string;
    amount?: number;
    customerMembershipId?: string;
    note?: string;
  },
  audit: AuditContext
) =>
  prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${input.invoiceId} FOR UPDATE`;
    const invoice = await tx.invoice.findFirst({
      where: {
        id: input.invoiceId,
        ...(actor.role === "SUPER_ADMIN"
          ? {}
          : { salonId: actor.salonId ?? "__unauthorized__" }),
      },
    });
    if (!invoice) {
      throw new CustomerMembershipError(404, "Invoice not found");
    }
    if (invoice.status === "CANCELLED") {
      throw new CustomerMembershipError(
        409,
        "Cannot pay a cancelled invoice from the wallet"
      );
    }
    if (invoice.status === "DRAFT") {
      throw new CustomerMembershipError(
        409,
        "Draft invoice must be issued before payment"
      );
    }
    if (invoice.paymentStatus === "PAID") {
      throw new CustomerMembershipError(409, "Invoice is already fully paid");
    }

    const now = new Date();
    const requested = input.amount
      ? new Prisma.Decimal(input.amount).toDecimalPlaces(2)
      : invoice.balanceAmount;
    if (requested.lte(zero)) {
      throw new CustomerMembershipError(400, "Amount must be greater than zero");
    }
    if (requested.gt(invoice.balanceAmount)) {
      throw new CustomerMembershipError(
        400,
        "Payment amount cannot be greater than invoice balance"
      );
    }

    const sources = input.customerMembershipId
      ? [
          await lockMembership(tx, actor, input.customerMembershipId).then(
            (row) => {
              if (!isSpendable(row, now)) {
                throw new CustomerMembershipError(
                  409,
                  "Membership is not active, its wallet cannot be used"
                );
              }
              return row;
            }
          ),
        ]
      : (
          await getSpendableWalletForCustomer(
            tx,
            actor,
            invoice.customerId,
            now
          )
        ).memberships;

    const available = sources.reduce(
      (sum, row) => sum.plus(row.walletBalance),
      zero
    );
    if (available.lt(requested)) {
      throw new CustomerMembershipError(
        400,
        "Insufficient membership wallet balance"
      );
    }

    const payment = await tx.payment.create({
      data: {
        salonId: invoice.salonId,
        ...(invoice.branchId ? { branchId: invoice.branchId } : {}),
        customerId: invoice.customerId,
        invoiceId: invoice.id,
        amount: requested,
        method: "MEMBERSHIP_WALLET",
        ...(input.note ? { note: input.note } : {}),
      },
    });

    let remaining = requested;
    const movements = [];
    for (const source of sources) {
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
        now,
      });
      if (movement) movements.push(movement);
      remaining = remaining.minus(take);
    }

    const paidAmount = invoice.paidAmount.plus(requested).toDecimalPlaces(2);
    const balanceAmount = invoice.totalAmount
      .minus(paidAmount)
      .toDecimalPlaces(2);
    const updatedInvoice = await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        paidAmount,
        balanceAmount,
        paymentStatus: balanceAmount.lte(zero) ? "PAID" : "PARTIALLY_PAID",
      },
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
        narration: "Payment received from membership wallet",
        type: "PAYMENT",
        debit: 0,
        credit: requested,
        balanceAfter: customer.outstandingAmount,
        status: "COMPLETE",
      },
    });

    await createAuditLog({
      tx,
      salonId: invoice.salonId,
      branchId: invoice.branchId,
      userId: actor.userId,
      module: "PAYMENT",
      action: "PAYMENT_RECORDED",
      entityId: payment.id,
      entityCode: invoice.invoiceCode,
      description: `Invoice ${invoice.invoiceCode} paid ${requested} from membership wallet`,
      oldData: {
        paidAmount: invoice.paidAmount,
        balanceAmount: invoice.balanceAmount,
        paymentStatus: invoice.paymentStatus,
      },
      newData: {
        amount: requested,
        method: "MEMBERSHIP_WALLET",
        paidAmount,
        balanceAmount,
        paymentStatus: updatedInvoice.paymentStatus,
        walletSources: movements.map((movement) => ({
          customerMembershipId: movement.ledger.customerMembershipId,
          debit: movement.ledger.debit,
          balanceAfter: movement.balanceAfter,
        })),
      },
      ...audit,
    });

    return { payment, invoice: updatedInvoice, movements };
  });

/** Returns wallet money to the membership, e.g. when a bill is cancelled. */
export const refundToMembershipWallet = async (
  tx: TransactionClient,
  input: {
    actor: CustomerMembershipActor;
    customerMembershipId: string;
    amount: Prisma.Decimal | number | string;
    narration?: string;
    invoiceId?: string;
    jobCartAppointmentId?: string;
  }
) => {
  const membership = await lockMembership(
    tx,
    input.actor,
    input.customerMembershipId
  );
  const amount = toDecimal(input.amount).toDecimalPlaces(2);
  if (amount.lte(zero)) return null;

  return applyWalletMovement(tx, {
    membership,
    amount,
    direction: "CREDIT",
    type: "REFUND",
    narration: input.narration ?? "Refund to membership wallet",
    createdById: input.actor.userId,
    ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
    ...(input.jobCartAppointmentId
      ? { jobCartAppointmentId: input.jobCartAppointmentId }
      : {}),
  });
};

/**
 * Zeroes out a wallet whose membership has stopped being ACTIVE and records
 * what was forfeited. Idempotent: a membership already forfeited, or one with
 * an empty wallet, produces no further rows.
 */
export const forfeitMembershipWallet = async (
  tx: TransactionClient,
  input: {
    customerMembershipId: string;
    actorUserId?: string;
    reason?: string;
  }
) => {
  await tx.$queryRaw`SELECT "id" FROM "CustomerMembership" WHERE "id" = ${input.customerMembershipId} FOR UPDATE`;
  const membership = await tx.customerMembership.findUnique({
    where: { id: input.customerMembershipId },
  });
  if (!membership) return null;
  if (membership.forfeitedAt) return null;
  if (membership.walletBalance.lte(zero)) return null;

  const forfeited = membership.walletBalance;
  const result = await applyWalletMovement(tx, {
    membership,
    amount: forfeited,
    direction: "DEBIT",
    type: "FORFEIT",
    narration:
      input.reason ??
      `Wallet forfeited when ${membership.membershipNameSnapshot} ended`,
    ...(input.actorUserId ? { createdById: input.actorUserId } : {}),
  });

  await tx.customerMembership.update({
    where: { id: membership.id },
    data: { forfeitedAmount: forfeited, forfeitedAt: new Date() },
  });

  return { ...result, forfeitedAmount: forfeited };
};

/** Wallet summary for one enrollment. */
export const getMembershipWallet = async (
  actor: CustomerMembershipActor,
  customerMembershipId: string
) => {
  const membership = await prisma.customerMembership.findFirst({
    where: { id: customerMembershipId, ...walletScope(actor) },
    include: {
      customer: {
        select: { id: true, customerCode: true, name: true, phone: true },
      },
      membership: { select: { id: true, name: true } },
    },
  });
  if (!membership) {
    throw new CustomerMembershipError(404, "Customer membership not found");
  }

  return {
    customerMembershipId: membership.id,
    customerId: membership.customerId,
    customer: membership.customer,
    membershipName: membership.membershipNameSnapshot,
    status: membership.status,
    startsAt: membership.startsAt,
    expiresAt: membership.expiresAt,
    walletCredited: membership.walletCredited,
    walletDebited: membership.walletDebited,
    walletBalance: membership.walletBalance,
    forfeitedAmount: membership.forfeitedAmount,
    forfeitedAt: membership.forfeitedAt,
    spendable: isSpendable(membership, new Date()),
  };
};

/** Paginated ledger, filterable by customer, membership, and type. */
export const listMembershipWalletTransactions = async (
  actor: CustomerMembershipActor,
  filters: {
    page: number;
    limit: number;
    customerId?: string;
    customerMembershipId?: string;
    type?: MembershipWalletTransactionType;
    startDate?: Date;
    endDate?: Date;
  }
) => {
  const where: Prisma.MembershipWalletTransactionWhereInput = {
    ...ledgerScope(actor),
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.customerMembershipId
      ? { customerMembershipId: filters.customerMembershipId }
      : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.startDate || filters.endDate
      ? {
          createdAt: {
            ...(filters.startDate ? { gte: filters.startDate } : {}),
            ...(filters.endDate ? { lte: filters.endDate } : {}),
          },
        }
      : {}),
  };

  const [data, count] = await Promise.all([
    prisma.membershipWalletTransaction.findMany({
      where,
      include: {
        customer: { select: { id: true, customerCode: true, name: true } },
        customerMembership: {
          select: { id: true, membershipNameSnapshot: true },
        },
        createdBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    }),
    prisma.membershipWalletTransaction.count({ where }),
  ]);

  return {
    data,
    count,
    page: filters.page,
    pageSize: filters.limit,
    totalPages: Math.ceil(count / filters.limit),
  };
};

/**
 * Spendable wallet balance across the active memberships of a customer.
 * Used by billing to show what can be applied to the current bill.
 */
export const getSpendableWalletForCustomer = async (
  tx: TransactionClient,
  actor: CustomerMembershipActor,
  customerId: string,
  now = new Date()
) => {
  const memberships = await tx.customerMembership.findMany({
    where: {
      customerId,
      ...walletScope(actor),
      status: "ACTIVE",
      startsAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
      walletBalance: { gt: 0 },
    },
    orderBy: [{ expiresAt: "asc" }, { startsAt: "asc" }],
  });

  const total = memberships.reduce(
    (sum, row) => sum.plus(row.walletBalance),
    new Prisma.Decimal(0)
  );

  return { total, memberships };
};

/**
 * Wallet summary for one customer, for the billing screen: how much can be
 * put toward a bill right now, and which memberships it would come from.
 */
export const getCustomerWalletSummary = async (
  actor: CustomerMembershipActor,
  customerId: string
) => {
  const customer = await prisma.customer.findFirst({
    where: {
      id: customerId,
      ...(actor.role === "SUPER_ADMIN"
        ? {}
        : { salonId: actor.salonId ?? "__unauthorized__" }),
    },
    select: { id: true, customerCode: true, name: true },
  });
  if (!customer) {
    throw new CustomerMembershipError(404, "Customer not found");
  }

  const { total, memberships } = await getSpendableWalletForCustomer(
    prisma,
    actor,
    customerId
  );

  return {
    customer,
    spendableBalance: total,
    memberships: memberships.map((row) => ({
      customerMembershipId: row.id,
      membershipName: row.membershipNameSnapshot,
      walletBalance: row.walletBalance,
      expiresAt: row.expiresAt,
    })),
  };
};
