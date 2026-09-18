import { prisma } from "../../config/prisma.js";

const include = {
  salon: { select: { id: true, name: true } },
  _count: {
    select: {
      products: true,
      productPurchases: true,
      vendorPayments: true,
      expenses: true,
    },
  },
} as const;

export const VendorModel = {
  list: (where: object) =>
    prisma.vendor.findMany({ where, include, orderBy: { name: "asc" } }),
  find: (where: object) => prisma.vendor.findFirst({ where, include }),
  duplicate: (salonId: string, name: string, excludeId?: string) =>
    prisma.vendor.findFirst({
      where: {
        salonId,
        name: { equals: name, mode: "insensitive" },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    }),
  create: (data: Parameters<typeof prisma.vendor.create>[0]["data"]) =>
    prisma.vendor.create({ data, include }),
  update: (
    id: string,
    data: Parameters<typeof prisma.vendor.update>[0]["data"]
  ) => prisma.vendor.update({ where: { id }, data, include }),
  remove: (id: string) => prisma.vendor.delete({ where: { id } }),
};

/**
 * Purchase and payment totals per vendor. `scope` narrows to the caller's
 * branch so branch users only see their own spend.
 */
export const vendorStats = async (vendorIds: string[], scope: object) => {
  const [purchases, payments] = await Promise.all([
    prisma.productPurchase.groupBy({
      by: ["vendorId"],
      where: { vendorId: { in: vendorIds }, ...scope },
      _sum: { totalAmount: true },
      _max: { purchaseDate: true },
    }),
    prisma.vendorPayment.groupBy({
      by: ["vendorId"],
      where: { vendorId: { in: vendorIds }, ...scope },
      _sum: { amount: true },
    }),
  ]);
  const paid = new Map(payments.map((p) => [p.vendorId, Number(p._sum.amount ?? 0)]));
  const stats = new Map<string, { totalPurchased: number; totalPaid: number; due: number; lastPurchaseAt: Date | null }>();
  for (const id of vendorIds) {
    const row = purchases.find((p) => p.vendorId === id);
    const totalPurchased = Number(row?._sum.totalAmount ?? 0);
    const totalPaid = paid.get(id) ?? 0;
    stats.set(id, { totalPurchased, totalPaid, due: totalPurchased - totalPaid, lastPurchaseAt: row?._max.purchaseDate ?? null });
  }
  return stats;
};
