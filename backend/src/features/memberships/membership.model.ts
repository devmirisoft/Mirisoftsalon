import { prisma } from "../../config/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";

const include = () => {
  const now = new Date();

  return {
    salon: {
      select: {
        id: true,
        name: true,
      },
    },
    _count: {
      select: {
        customers: {
          where: {
            membershipHistory: {
              none: {},
            },
          },
        },
        customerMemberships: {
          where: {
            status: "ACTIVE",
            startsAt: { lte: now },
            OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
          },
        },
      },
    },
  } satisfies Prisma.MembershipInclude;
};

export const MembershipModel = {
  create: (data: {
    salonId: string;
    name: string;
    description?: string;
    discountPercentage?: number;
    durationMonths?: number | null;
    price?: number;
    walletCreditAmount?: number;
  }, tx?: Prisma.TransactionClient) => (tx ?? prisma).membership.create({ data, include: include() }),

  list: (salonId?: string) =>
    prisma.membership.findMany({
      ...(salonId ? { where: { salonId } } : {}),
      include: include(),
      orderBy: {
        name: "asc",
      },
    }),

  find: (id: string, salonId?: string) =>
    prisma.membership.findFirst({
      where: {
        id,
        ...(salonId ? { salonId } : {}),
      },
      include: include(),
    }),

  duplicate: (salonId: string, name: string, excludeId?: string) =>
    prisma.membership.findFirst({
      where: {
        salonId,
        name: {
          equals: name,
          mode: "insensitive",
        },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: {
        id: true,
      },
    }),

  salonExists: (salonId: string) =>
    prisma.salon.findUnique({
      where: {
        id: salonId,
      },
      select: {
        id: true,
      },
    }),

  hasCustomerHistory: (membershipId: string) =>
    prisma.customerMembership.findFirst({
      where: {
        membershipId,
      },
      select: {
        id: true,
      },
    }),

  update: (
    id: string,
    data: {
      name?: string;
      description?: string | null;
      discountPercentage?: number;
      durationMonths?: number | null;
      price?: number;
      walletCreditAmount?: number;
      status?: boolean;
    },
    tx?: Prisma.TransactionClient
  ) =>
    (tx ?? prisma).membership.update({
      where: {
        id,
      },
      data,
      include: include(),
    }),

  remove: (id: string, tx?: Prisma.TransactionClient) =>
    (tx ?? prisma).membership.delete({
      where: {
        id,
      },
    }),
};
