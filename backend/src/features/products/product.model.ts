import { prisma } from "../../config/prisma.js";
import { productInclude } from "./inventory-access.js";

export const ProductModel = {
  list: (where: object) =>
    prisma.product.findMany({
      where,
      include: productInclude,
      orderBy: { name: "asc" },
    }),
  find: (where: object) =>
    prisma.product.findFirst({ where, include: productInclude }),
  duplicate: (salonId: string, name: string, excludeId?: string) =>
    prisma.product.findFirst({
      where: {
        salonId,
        name: { equals: name, mode: "insensitive" },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    }),
  create: (data: Parameters<typeof prisma.product.create>[0]["data"]) =>
    prisma.product.create({ data, include: productInclude }),
  update: (
    id: string,
    data: Parameters<typeof prisma.product.update>[0]["data"]
  ) => prisma.product.update({ where: { id }, data, include: productInclude }),
  remove: (id: string) => prisma.product.delete({ where: { id } }),
};

// Only issued bills count as sales; drafts and cancelled invoices are excluded.
const soldInvoiceItem = { itemType: "PRODUCT" as const, invoice: { status: "ISSUED" as const } };

/** Units sold, revenue and last purchase date per product (sales = job-cart invoices + retail sales). */
export const productSalesStats = async (productIds: string[]) => {
  const [invoiceRows, retailRows, lastPurchases] = await Promise.all([
    prisma.invoiceItem.groupBy({
      by: ["productId"],
      where: { ...soldInvoiceItem, productId: { in: productIds } },
      _sum: { quantity: true, taxableAmount: true },
      _count: { _all: true },
    }),
    prisma.retailSaleItem.groupBy({
      by: ["productId"],
      where: { productId: { in: productIds } },
      _sum: { quantity: true, totalPrice: true },
      _count: { _all: true },
    }),
    prisma.productPurchaseItem.findMany({
      where: { productId: { in: productIds } },
      orderBy: { purchase: { purchaseDate: "desc" } },
      distinct: ["productId"],
      select: { productId: true, purchase: { select: { purchaseDate: true } } },
    }),
  ]);
  // saleCount = sale lines, i.e. how many bills / counter sales included the product.
  type Stats = { soldQty: number; revenue: number; saleCount: number; lastPurchaseAt: Date | null };
  const stats = new Map<string, Stats>();
  const add = (id: string | null, qty: unknown, amount: unknown, count: number) => {
    if (!id) return;
    const row = stats.get(id) ?? { soldQty: 0, revenue: 0, saleCount: 0, lastPurchaseAt: null };
    row.soldQty += Number(qty ?? 0);
    row.revenue += Number(amount ?? 0);
    row.saleCount += count;
    stats.set(id, row);
  };
  invoiceRows.forEach((r) => add(r.productId, r._sum.quantity, r._sum.taxableAmount, r._count._all));
  retailRows.forEach((r) => add(r.productId, r._sum.quantity, r._sum.totalPrice, r._count._all));
  lastPurchases.forEach((r) => {
    add(r.productId, 0, 0, 0);
    stats.get(r.productId)!.lastPurchaseAt = r.purchase.purchaseDate;
  });
  return stats;
};

/** Sale lines and purchase lines for one product, newest first. */
export const productActivity = async (productId: string) => {
  const [invoiceItems, retailItems, purchaseItems] = await Promise.all([
    prisma.invoiceItem.findMany({
      where: { ...soldInvoiceItem, productId },
      include: {
        invoice: { select: { id: true, invoiceCode: true, invoiceDate: true, customerName: true, customerPhone: true } },
        soldByStaff: { select: { name: true } },
      },
    }),
    prisma.retailSaleItem.findMany({
      where: { productId },
      include: {
        sale: {
          select: {
            id: true,
            saleCode: true,
            saleDate: true,
            customer: { select: { name: true, phone: true } },
            staff: { select: { name: true } },
          },
        },
      },
    }),
    prisma.productPurchaseItem.findMany({
      where: { productId },
      include: {
        purchase: {
          select: {
            id: true,
            purchaseCode: true,
            purchaseDate: true,
            invoiceNo: true,
            supplierName: true,
            paymentStatus: true,
            vendor: { select: { id: true, name: true, phone: true } },
          },
        },
      },
      orderBy: { purchase: { purchaseDate: "desc" } },
    }),
  ]);
  const sales = [
    ...invoiceItems.map((item) => ({
      id: item.id,
      source: "INVOICE",
      referenceId: item.invoice.id,
      reference: item.invoice.invoiceCode,
      date: item.invoice.invoiceDate,
      customerName: item.invoice.customerName,
      customerPhone: item.invoice.customerPhone,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      discount: Number(item.discountAmount),
      netAmount: Number(item.taxableAmount),
      staffName: item.soldByStaff?.name ?? null,
    })),
    ...retailItems.map((item) => ({
      id: item.id,
      source: "RETAIL",
      referenceId: item.sale.id,
      reference: item.sale.saleCode,
      date: item.sale.saleDate,
      customerName: item.sale.customer?.name ?? "Walk-in",
      customerPhone: item.sale.customer?.phone ?? null,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      discount: 0,
      netAmount: Number(item.totalPrice),
      staffName: item.sale.staff?.name ?? null,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());
  const purchases = purchaseItems.map((item) => ({
    id: item.id,
    purchaseId: item.purchase.id,
    purchaseCode: item.purchase.purchaseCode,
    date: item.purchase.purchaseDate,
    invoiceNo: item.purchase.invoiceNo,
    vendor: item.purchase.vendor,
    vendorName: item.purchase.vendor?.name ?? item.purchase.supplierName ?? null,
    quantity: Number(item.quantity),
    unitCost: Number(item.unitCost),
    totalCost: Number(item.totalCost),
    paymentStatus: item.purchase.paymentStatus,
  }));
  return { sales, purchases };
};
