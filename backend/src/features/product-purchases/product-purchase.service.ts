import { randomUUID } from "node:crypto";
import { Prisma, type InventoryLocation } from "../../generated/prisma/client.js";
import { buildBusinessCode } from "../../utils/business-id.js";
import { transactionError } from "../products/inventory-access.js";
import { createStockMovement } from "../stock/stockMovement.service.js";

type TransactionClient = Prisma.TransactionClient;

export type ReceivedPurchaseItem = {
  productId: string;
  quantity: Prisma.Decimal | number | string;
  unitCost: Prisma.Decimal | number | string;
};

type CreateReceivedPurchaseInput = {
  tx: TransactionClient;
  salonId: string;
  branchId?: string;
  vendorId?: string;
  supplierName?: string;
  supplierPhone?: string;
  invoiceNo?: string;
  purchaseDate?: Date;
  note?: string;
  createdById?: string;
  /** Receiving location; defaults to each product's default location. */
  location?: InventoryLocation;
  items: ReceivedPurchaseItem[];
  /** Purchase tax on top of the item subtotal. */
  taxAmount?: number;
  /** Paid at receipt; recorded as a vendor payment against this purchase. */
  paidAmount?: number;
  paymentMethod?: Prisma.VendorPaymentCreateInput["paymentMethod"];
};

export const createReceivedProductPurchase = async (
  input: CreateReceivedPurchaseInput
) => {
  if (input.items.length === 0) {
    throw transactionError("At least one purchase item is required");
  }

  const salon = await input.tx.salon.findUnique({
    where: { id: input.salonId },
    select: { name: true, timezone: true },
  });
  if (!salon) {
    throw transactionError("Invalid salon");
  }

  const items = input.items.map((item) => {
    const quantity = new Prisma.Decimal(item.quantity);
    const unitCost = new Prisma.Decimal(item.unitCost);
    if (
      !quantity.isFinite() ||
      quantity.lessThanOrEqualTo(0) ||
      !unitCost.isFinite() ||
      unitCost.isNegative()
    ) {
      throw transactionError(
        "Purchase quantities must be positive and unit costs non-negative"
      );
    }
    return { ...item, quantity, unitCost };
  });

  if (new Set(items.map((item) => item.productId)).size !== items.length) {
    throw transactionError("Each product may appear only once per purchase");
  }

  if (input.branchId) {
    const branch = await input.tx.branch.findFirst({
      where: { id: input.branchId, salonId: input.salonId },
      select: { id: true },
    });
    if (!branch) throw transactionError("Invalid branch for this salon");
  }

  const products = await input.tx.product.findMany({
    where: {
      id: { in: items.map((item) => item.productId) },
      salonId: input.salonId,
    },
  });
  if (products.length !== items.length) {
    throw transactionError("One or more products were not found", 404);
  }
  if (
    input.branchId &&
    products.some(
      (product) => product.branchId && product.branchId !== input.branchId
    )
  ) {
    throw transactionError("A product does not belong to the selected branch");
  }

  const vendor = input.vendorId
    ? await input.tx.vendor.findFirst({
        where: { id: input.vendorId, salonId: input.salonId },
        select: { id: true, name: true, phone: true, status: true },
      })
    : null;
  if (input.vendorId && !vendor) {
    throw transactionError("Vendor not found", 404);
  }
  if (vendor && !vendor.status) {
    throw transactionError("Vendor is inactive");
  }

  const purchaseId = randomUUID();
  const subtotal = items.reduce(
    (sum, item) => sum.plus(item.quantity.mul(item.unitCost)),
    new Prisma.Decimal(0)
  );
  const tax = new Prisma.Decimal(input.taxAmount ?? 0);
  if (!tax.isFinite() || tax.isNegative()) {
    throw transactionError("Tax must be a non-negative amount");
  }
  const total = subtotal.plus(tax);
  const paid = new Prisma.Decimal(input.paidAmount ?? 0);
  if (!paid.isFinite() || paid.isNegative() || paid.greaterThan(total)) {
    throw transactionError("Paid amount must be between 0 and the purchase total");
  }
  if (paid.greaterThan(0) && (!vendor || !input.paymentMethod)) {
    throw transactionError("Select a vendor and payment method to record a payment");
  }

  for (const item of [...items].sort((left, right) =>
    left.productId.localeCompare(right.productId)
  )) {
    await createStockMovement({
      tx: input.tx,
      salonId: input.salonId,
      ...(input.branchId ? { branchId: input.branchId } : {}),
      productId: item.productId,
      type: "STOCK_IN",
      quantity: item.quantity,
      ...(input.location ? { location: input.location } : {}),
      referenceType: "PRODUCT_PURCHASE",
      referenceId: purchaseId,
      ...(input.createdById ? { createdById: input.createdById } : {}),
    });
    await input.tx.product.update({
      where: { id: item.productId },
      data: { costPrice: item.unitCost },
    });
  }

  const purchase = await input.tx.productPurchase.create({
    data: {
      id: purchaseId,
      purchaseCode: buildBusinessCode({
        salonName: salon.name,
        type: "PUR",
        timezone: salon.timezone,
      }),
      salonId: input.salonId,
      branchId: input.branchId ?? null,
      vendorId: input.vendorId ?? null,
      supplierName: input.supplierName ?? vendor?.name ?? null,
      supplierPhone: input.supplierPhone ?? vendor?.phone ?? null,
      invoiceNo: input.invoiceNo ?? null,
      ...(input.purchaseDate ? { purchaseDate: input.purchaseDate } : {}),
      note: input.note ?? null,
      subtotalAmount: subtotal,
      totalAmount: total,
      paidAmount: paid,
      balanceAmount: total.minus(paid),
      paymentStatus: paid.isZero() ? "UNPAID" : paid.equals(total) ? "PAID" : "PARTIALLY_PAID",
      createdById: input.createdById ?? null,
      items: {
        create: items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          unitCost: item.unitCost,
          totalCost: item.quantity.mul(item.unitCost),
        })),
      },
    },
    include: {
      items: true,
      vendor: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
    },
  });

  if (vendor && input.paymentMethod && paid.greaterThan(0)) {
    await input.tx.vendorPayment.create({
      data: {
        salonId: input.salonId,
        vendorId: vendor.id,
        branchId: input.branchId ?? null,
        purchaseId,
        amount: paid,
        paymentMethod: input.paymentMethod,
        ...(input.purchaseDate ? { paymentDate: input.purchaseDate } : {}),
        note: "Paid at stock receipt",
        createdById: input.createdById ?? null,
      },
    });
  }
  return purchase;
};
