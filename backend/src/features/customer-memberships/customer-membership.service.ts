import { prisma } from "../../config/prisma.js";
import {
  Prisma,
  type CustomerMembershipStatus,
} from "../../generated/prisma/client.js";
import { createAuditLog } from "../audit-logs/audit-log.service.js";
import {
  creditPurchaseWallet,
  forfeitMembershipWallet,
} from "../membership-wallets/membership-wallet.service.js";

type TransactionClient = Prisma.TransactionClient;
type AuditContext = { ipAddress?: string; userAgent?: string };

export type CustomerMembershipActor = {
  userId: string;
  role: string;
  salonId?: string;
  branchId?: string;
};

export class CustomerMembershipError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "CustomerMembershipError";
  }
}

const branchScopedRoles = new Set(["BRANCH_MANAGER", "RECEPTIONIST"]);

const addMonths = (value: Date, months: number) => {
  const date = new Date(value);
  date.setMonth(date.getMonth() + months);
  return date;
};

const historyInclude = {
  customer: {
    select: {
      id: true,
      customerCode: true,
      name: true,
      phone: true,
    },
  },
  membership: {
    select: {
      id: true,
      name: true,
      discountPercentage: true,
      status: true,
    },
  },
  assignedBy: { select: { id: true, name: true, role: true } },
  removedBy: { select: { id: true, name: true, role: true } },
} as const;

const historyScope = (
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

const customerScope = (
  actor: CustomerMembershipActor
): Prisma.CustomerWhereInput => {
  if (actor.role === "SUPER_ADMIN") return {};
  if (!actor.salonId) return { salonId: "__unauthorized__" };
  return {
    salonId: actor.salonId,
    ...(branchScopedRoles.has(actor.role)
      ? { branchId: actor.branchId ?? "__unauthorized__" }
      : {}),
  };
};

const materializeLegacyMemberships = async (
  tx: TransactionClient,
  actor: CustomerMembershipActor,
  customerId?: string
) => {
  const customers = await tx.customer.findMany({
    where: {
      ...customerScope(actor),
      ...(customerId ? { id: customerId } : {}),
      membershipId: { not: null },
      membershipHistory: { none: {} },
    },
    include: { membership: true },
  });
  for (const customer of customers) {
    if (!customer.membership) continue;
    await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${customer.id} FOR UPDATE`;
    if (
      (await tx.customerMembership.count({
        where: { customerId: customer.id },
      })) > 0
    ) {
      continue;
    }
    await tx.customerMembership.create({
      data: {
        salonId: customer.salonId,
        branchId: customer.branchId,
        customerId: customer.id,
        membershipId: customer.membership.id,
        membershipNameSnapshot: customer.membership.name,
        discountPercentageSnapshot:
          customer.membership.discountPercentage,
        startsAt: customer.updatedAt,
        status: customer.membership.status ? "ACTIVE" : "REMOVED",
        note: "Migrated from legacy customer membership pointer",
      },
    });
    if (!customer.membership.status) {
      await tx.customer.update({
        where: { id: customer.id },
        data: { membershipId: null },
      });
    }
  }
};

const expireMembershipRows = async (
  tx: TransactionClient,
  input: {
    where: Prisma.CustomerMembershipWhereInput;
    actor: CustomerMembershipActor;
    audit: AuditContext;
    now?: Date;
  }
) => {
  const now = input.now ?? new Date();
  const requestedCustomerId =
    typeof input.where.customerId === "string"
      ? input.where.customerId
      : undefined;
  await materializeLegacyMemberships(
    tx,
    input.actor,
    requestedCustomerId
  );
  const expired = await tx.customerMembership.findMany({
    where: {
      ...input.where,
      status: "ACTIVE",
      expiresAt: { lt: now },
    },
    include: historyInclude,
  });

  for (const row of expired) {
    await tx.$queryRaw`SELECT "id" FROM "CustomerMembership" WHERE "id" = ${row.id} FOR UPDATE`;
    const changed = await tx.customerMembership.updateMany({
      where: {
        id: row.id,
        status: "ACTIVE",
        expiresAt: { lt: now },
      },
      data: { status: "EXPIRED" },
    });
    if (changed.count !== 1) continue;

    const replacement = await tx.customerMembership.findFirst({
      where: {
        customerId: row.customerId,
        id: { not: row.id },
        status: "ACTIVE",
        startsAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
      },
      select: { id: true },
    });
    if (!replacement) {
      await tx.customer.updateMany({
        where: {
          id: row.customerId,
          membershipId: row.membershipId,
        },
        data: { membershipId: null },
      });
    }

    const forfeit = await forfeitMembershipWallet(tx, {
      customerMembershipId: row.id,
      ...(input.actor.userId ? { actorUserId: input.actor.userId } : {}),
      reason: `Wallet forfeited when ${row.membershipNameSnapshot} expired`,
    });

    await createAuditLog({
      tx,
      salonId: row.salonId,
      branchId: row.branchId,
      userId: input.actor.userId,
      module: "MEMBERSHIP",
      action: "STATUS_CHANGE",
      entityId: row.id,
      entityCode: row.customer.customerCode,
      entityName: row.customer.name,
      description: `Customer membership ${row.membershipNameSnapshot} expired`,
      oldData: {
        status: "ACTIVE",
        expiresAt: row.expiresAt,
        walletBalance: row.walletBalance,
      },
      newData: {
        status: "EXPIRED",
        expiresAt: row.expiresAt,
        forfeitedAmount: forfeit?.forfeitedAmount ?? 0,
      },
      ...input.audit,
    });
  }
};

export type CurrentCustomerMembership = {
  id: string | null;
  membershipId: string;
  membershipNameSnapshot: string;
  discountPercentageSnapshot: Prisma.Decimal;
  startsAt: Date | null;
  expiresAt: Date | null;
  status: "ACTIVE";
  legacy: boolean;
};

export const resolveCurrentCustomerMembership = async (
  tx: TransactionClient,
  input: {
    customerId: string;
    actor: CustomerMembershipActor;
    audit: AuditContext;
    now?: Date;
  }
): Promise<CurrentCustomerMembership | null> => {
  const now = input.now ?? new Date();
  await expireMembershipRows(tx, {
    where: { customerId: input.customerId, ...historyScope(input.actor) },
    actor: input.actor,
    audit: input.audit,
    now,
  });

  const current = await tx.customerMembership.findFirst({
    where: {
      customerId: input.customerId,
      ...historyScope(input.actor),
      status: "ACTIVE",
      startsAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
    },
    orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
  });
  if (current) {
    return {
      id: current.id,
      membershipId: current.membershipId,
      membershipNameSnapshot: current.membershipNameSnapshot,
      discountPercentageSnapshot: current.discountPercentageSnapshot,
      startsAt: current.startsAt,
      expiresAt: current.expiresAt,
      status: "ACTIVE",
      legacy: false,
    };
  }

  const historyCount = await tx.customerMembership.count({
    where: { customerId: input.customerId },
  });
  if (historyCount > 0) return null;

  const legacy = await tx.customer.findFirst({
    where: {
      id: input.customerId,
      ...customerScope(input.actor),
    },
    select: {
      membership: {
        select: {
          id: true,
          name: true,
          discountPercentage: true,
          status: true,
        },
      },
    },
  });
  if (!legacy?.membership?.status) return null;
  return {
    id: null,
    membershipId: legacy.membership.id,
    membershipNameSnapshot: legacy.membership.name,
    discountPercentageSnapshot: legacy.membership.discountPercentage,
    startsAt: null,
    expiresAt: null,
    status: "ACTIVE",
    legacy: true,
  };
};

export const assignCustomerMembershipHistory = async (
  actor: CustomerMembershipActor,
  customerId: string,
  input: {
    membershipId: string;
    startsAt?: Date;
    expiresAt?: Date | null;
    walletCreditAmount?: number;
    note?: string;
    invoiceId?: string;
    jobCartAppointmentId?: string;
    auditEntityId?: string;
    auditAction?: "CREATE" | "UPDATE";
  },
  audit: AuditContext
) =>
  prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE`;
    const customer = await tx.customer.findFirst({
      where: { id: customerId, ...customerScope(actor) },
      select: {
        id: true,
        customerCode: true,
        name: true,
        salonId: true,
        branchId: true,
        membershipId: true,
      },
    });
    if (!customer) {
      throw new CustomerMembershipError(404, "Customer not found");
    }

    const membership = await tx.membership.findFirst({
      where: {
        id: input.membershipId,
        salonId: customer.salonId,
      },
    });
    if (!membership) {
      throw new CustomerMembershipError(
        400,
        "Membership must belong to the same salon as the customer"
      );
    }
    if (!membership.status) {
      throw new CustomerMembershipError(
        400,
        "Only active memberships can be assigned"
      );
    }

    const startsAt = input.startsAt ?? new Date();
    // Validity comes from the plan. A plan with no durationMonths never
    // expires. An explicit expiresAt on the request still wins, so an admin
    // can override a single enrollment.
    const expiresAt =
      input.expiresAt !== undefined
        ? input.expiresAt
        : membership.durationMonths
          ? addMonths(startsAt, membership.durationMonths)
          : null;
    if (expiresAt && expiresAt < startsAt) {
      throw new CustomerMembershipError(
        400,
        "Membership expiry must be on or after its start date"
      );
    }

    await expireMembershipRows(tx, {
      where: { customerId: customer.id },
      actor,
      audit,
    });
    const previous = await tx.customerMembership.findMany({
      where: { customerId: customer.id, status: "ACTIVE" },
      orderBy: { startsAt: "desc" },
    });
    const historicalCount = await tx.customerMembership.count({
      where: { customerId: customer.id },
    });
    const now = new Date();
    for (const row of previous) {
      const status: CustomerMembershipStatus =
        row.expiresAt && row.expiresAt < now ? "EXPIRED" : "REMOVED";
      await tx.customerMembership.update({
        where: { id: row.id },
        data: {
          status,
          ...(status === "REMOVED"
            ? {
                removedAt: now,
                removedById: actor.userId,
              }
            : {}),
        },
      });
      await forfeitMembershipWallet(tx, {
        customerMembershipId: row.id,
        actorUserId: actor.userId,
        reason: `Wallet forfeited when ${row.membershipNameSnapshot} was superseded`,
      });
    }

    const created = await tx.customerMembership.create({
      data: {
        salonId: customer.salonId,
        branchId: customer.branchId,
        customerId: customer.id,
        membershipId: membership.id,
        membershipNameSnapshot: membership.name,
        discountPercentageSnapshot: membership.discountPercentage,
        durationMonthsSnapshot: membership.durationMonths,
        startsAt,
        expiresAt,
        assignedById: actor.userId,
        ...(input.note ? { note: input.note } : {}),
        ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
        ...(input.jobCartAppointmentId
          ? { jobCartAppointmentId: input.jobCartAppointmentId }
          : {}),
      },
      include: historyInclude,
    });
    await tx.customer.update({
      where: { id: customer.id },
      data: { membershipId: membership.id },
    });

    // Selling the plan funds its wallet. walletCreditAmount can differ from
    // price when a plan is sold at a discount (pay 5000, get 6000 to spend).
    const walletCredit =
      input.walletCreditAmount !== undefined
        ? new Prisma.Decimal(input.walletCreditAmount)
        : membership.walletCreditAmount;
    const walletMovement = await creditPurchaseWallet(tx, {
      membership: created,
      amount: walletCredit,
      createdById: actor.userId,
      ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
      ...(input.jobCartAppointmentId
        ? { jobCartAppointmentId: input.jobCartAppointmentId }
        : {}),
    });

    const renewed =
      historicalCount > 0 ||
      previous.length > 0 ||
      customer.membershipId !== null;
    await createAuditLog({
      tx,
      salonId: customer.salonId,
      branchId: customer.branchId,
      userId: actor.userId,
      module: "MEMBERSHIP",
      action: input.auditAction ?? (renewed ? "UPDATE" : "CREATE"),
      entityId: input.auditEntityId ?? created.id,
      entityCode: customer.customerCode,
      entityName: customer.name,
      description: `Customer membership ${membership.name} ${renewed ? "renewed" : "assigned"}`,
      oldData: {
        membershipId: customer.membershipId,
        activeCustomerMembershipIds: previous.map((row) => row.id),
      },
      newData: {
        customerMembershipId: created.id,
        membershipId: membership.id,
        startsAt,
        expiresAt,
        status: created.status,
        durationMonths: membership.durationMonths,
        walletCredited: walletMovement?.balanceAfter ?? created.walletBalance,
      },
      ...audit,
    });
    return walletMovement
      ? { ...created, ...walletMovement.membership }
      : created;
  });

export const endCustomerMembership = async (
  actor: CustomerMembershipActor,
  id: string,
  status: Exclude<CustomerMembershipStatus, "ACTIVE">,
  audit: AuditContext
) =>
  prisma.$transaction(async (tx) => {
    const existing = await tx.customerMembership.findFirst({
      where: { id, ...historyScope(actor) },
      include: historyInclude,
    });
    if (!existing) {
      throw new CustomerMembershipError(404, "Customer membership not found");
    }
    await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${existing.customerId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "CustomerMembership" WHERE "id" = ${id} FOR UPDATE`;
    if (existing.status !== "ACTIVE") {
      throw new CustomerMembershipError(
        409,
        "Customer membership is no longer active"
      );
    }

    const removed = status === "REMOVED" || status === "CANCELLED";
    const now = new Date();
    await tx.customerMembership.update({
      where: { id },
      data: {
        status,
        ...(removed
          ? {
              removedAt: now,
              removedById: actor.userId,
            }
          : {}),
      },
    });
    const forfeit = await forfeitMembershipWallet(tx, {
      customerMembershipId: id,
      actorUserId: actor.userId,
      reason: `Wallet forfeited when ${existing.membershipNameSnapshot} was ${status.toLowerCase()}`,
    });
    const updated = await tx.customerMembership.findUniqueOrThrow({
      where: { id },
      include: historyInclude,
    });
    await tx.customer.updateMany({
      where: {
        id: existing.customerId,
        membershipId: existing.membershipId,
      },
      data: { membershipId: null },
    });
    await createAuditLog({
      tx,
      salonId: existing.salonId,
      branchId: existing.branchId,
      userId: actor.userId,
      module: "MEMBERSHIP",
      action: status === "EXPIRED" ? "STATUS_CHANGE" : "DELETE",
      entityId: existing.id,
      entityCode: existing.customer.customerCode,
      entityName: existing.customer.name,
      description: `Customer membership ${existing.membershipNameSnapshot} ${status.toLowerCase()}`,
      oldData: {
        status: existing.status,
        walletBalance: existing.walletBalance,
      },
      newData: {
        status,
        removedAt: updated.removedAt,
        removedById: updated.removedById,
        forfeitedAmount: forfeit?.forfeitedAmount ?? 0,
      },
      ...audit,
    });
    return updated;
  });

export const listCustomerMembershipHistory = async (
  actor: CustomerMembershipActor,
  filters: {
    page: number;
    limit: number;
    customerId?: string;
    membershipId?: string;
    status?: CustomerMembershipStatus;
    startDate?: Date;
    endDate?: Date;
    search?: string;
  },
  audit: AuditContext
) =>
  prisma.$transaction(async (tx) => {
    const scope = historyScope(actor);
    await expireMembershipRows(tx, {
      where: scope,
      actor,
      audit,
    });
    const where: Prisma.CustomerMembershipWhereInput = {
      ...scope,
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
      ...(filters.membershipId
        ? { membershipId: filters.membershipId }
        : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.startDate || filters.endDate
        ? {
            startsAt: {
              ...(filters.startDate ? { gte: filters.startDate } : {}),
              ...(filters.endDate ? { lte: filters.endDate } : {}),
            },
          }
        : {}),
      ...(filters.search
        ? {
            OR: [
              {
                membershipNameSnapshot: {
                  contains: filters.search,
                  mode: "insensitive",
                },
              },
              {
                customer: {
                  name: { contains: filters.search, mode: "insensitive" },
                },
              },
              {
                customer: {
                  phone: { contains: filters.search, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };
    const [data, count] = await Promise.all([
      tx.customerMembership.findMany({
        where,
        include: historyInclude,
        orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      tx.customerMembership.count({ where }),
    ]);
    return {
      data,
      count,
      page: filters.page,
      pageSize: filters.limit,
      totalPages: Math.ceil(count / filters.limit),
    };
  });

export const getCustomerMembershipHistory = async (
  actor: CustomerMembershipActor,
  customerId: string,
  audit: AuditContext
) => {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, ...customerScope(actor) },
    select: { id: true },
  });
  if (!customer) {
    throw new CustomerMembershipError(404, "Customer not found");
  }
  const result = await listCustomerMembershipHistory(
    actor,
    { page: 1, limit: 100, customerId },
    audit
  );
  return result.data;
};

export const getCustomerMembershipById = async (
  actor: CustomerMembershipActor,
  id: string,
  audit: AuditContext
) =>
  prisma.$transaction(async (tx) => {
    await expireMembershipRows(tx, {
      where: { id, ...historyScope(actor) },
      actor,
      audit,
    });
    const data = await tx.customerMembership.findFirst({
      where: { id, ...historyScope(actor) },
      include: historyInclude,
    });
    if (!data) {
      throw new CustomerMembershipError(404, "Customer membership not found");
    }
    return data;
  });

export const getCurrentMembershipForCustomer = async (
  actor: CustomerMembershipActor,
  customerId: string,
  audit: AuditContext
) =>
  prisma.$transaction((tx) =>
    resolveCurrentCustomerMembership(tx, {
      customerId,
      actor,
      audit,
    })
  );

export const synchronizeCustomerMembershipExpiry = async (
  actor: CustomerMembershipActor,
  audit: AuditContext,
  customerId?: string
) =>
  prisma.$transaction((tx) =>
    expireMembershipRows(tx, {
      where: {
        ...historyScope(actor),
        ...(customerId ? { customerId } : {}),
      },
      actor,
      audit,
    })
  );
