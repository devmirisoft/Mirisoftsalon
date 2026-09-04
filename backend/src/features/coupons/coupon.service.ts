import { prisma } from "../../config/prisma.js";
import {
  Prisma,
  type Coupon,
  type Invoice,
} from "../../generated/prisma/client.js";
import {
  createAuditLog,
  type requestAuditContext,
} from "../audit-logs/audit-log.service.js";
import { CouponModel } from "./coupon.model.js";
import { CustomerModel } from "../customers/customer.model.js";
import { calculateInvoiceGst } from "../Invoices/invoice-gst.service.js";
import type {
  CreateCouponInput,
  UpdateCouponInput,
} from "./coupon.validation.js";

type AuditContext = ReturnType<typeof requestAuditContext> & {
  userId?: string;
};

export class CouponServiceError extends Error {
  constructor(
    message: string,
    public readonly status = 400
  ) {
    super(message);
  }
}

const safeCoupon = (coupon: {
  id: string;
  couponCode: string;
  name: string | null;
  description: string | null;
  discountPercentage: unknown;
  validFrom: Date;
  validUntil: Date;
  isActive: boolean;
  maxUsageCount: number | null;
  usedCount: number;
  minInvoiceAmount: unknown;
  salonId: string;
  branchId: string | null;
}) => ({
  couponId: coupon.id,
  couponCode: coupon.couponCode,
  name: coupon.name,
  description: coupon.description,
  discountPercentage: coupon.discountPercentage,
  validFrom: coupon.validFrom,
  validUntil: coupon.validUntil,
  isActive: coupon.isActive,
  maxUsageCount: coupon.maxUsageCount,
  usedCount: coupon.usedCount,
  minInvoiceAmount: coupon.minInvoiceAmount,
  salonId: coupon.salonId,
  branchId: coupon.branchId,
});

const ensureBranch = async (
  salonId: string,
  branchId: string | null | undefined
) => {
  if (!branchId) return;
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, salonId },
    select: { id: true },
  });
  if (!branch) {
    throw new CouponServiceError(
      "Branch must belong to the coupon salon",
      400
    );
  }
};

const ensureUniqueCode = async (
  salonId: string,
  couponCode: string,
  excludeId?: string
) => {
  if (await CouponModel.duplicate(salonId, couponCode, excludeId)) {
    throw new CouponServiceError(
      "Coupon code already exists in this salon",
      409
    );
  }
};

export const createCoupon = async (
  salonId: string,
  input: CreateCouponInput,
  audit: AuditContext
) => {
  await ensureBranch(salonId, input.branchId);
  await ensureUniqueCode(salonId, input.couponCode);

  return prisma.$transaction(async (tx) => {
    const created = await CouponModel.create(
      {
        salonId,
        couponCode: input.couponCode,
        discountPercentage: input.discountPercentage,
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        ...(input.branchId ? { branchId: input.branchId } : {}),
        ...(input.name ? { name: input.name } : {}),
        ...(input.description ? { description: input.description } : {}),
        ...(input.isActive !== undefined
          ? { isActive: input.isActive }
          : {}),
        ...(input.maxUsageCount !== undefined
          ? { maxUsageCount: input.maxUsageCount }
          : {}),
        ...(input.minInvoiceAmount !== undefined
          ? { minInvoiceAmount: input.minInvoiceAmount }
          : {}),
        ...(audit.userId ? { createdById: audit.userId } : {}),
      },
      tx
    );
    await createAuditLog({
      tx,
      salonId,
      branchId: created.branchId,
      userId: audit.userId,
      module: "COUPON",
      action: "CREATE",
      entityId: created.id,
      entityCode: created.couponCode,
      entityName: created.couponCode,
      description: `Coupon ${created.couponCode} created`,
      newData: safeCoupon(created),
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
    return created;
  });
};

export const updateCoupon = async (
  existing: Coupon,
  input: UpdateCouponInput,
  audit: AuditContext
) => {
  const couponCode = input.couponCode ?? existing.couponCode;
  const validFrom = input.validFrom ?? existing.validFrom;
  const validUntil = input.validUntil ?? existing.validUntil;
  const branchId =
    input.branchId === undefined ? existing.branchId : input.branchId;

  if (validUntil <= validFrom) {
    throw new CouponServiceError(
      "validUntil must be after validFrom",
      400
    );
  }
  await ensureBranch(existing.salonId, branchId);
  await ensureUniqueCode(existing.salonId, couponCode, existing.id);

  return prisma.$transaction(async (tx) => {
    const updated = await CouponModel.update(
      existing.id,
      {
        ...(input.couponCode !== undefined
          ? { couponCode: input.couponCode }
          : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.discountPercentage !== undefined
          ? { discountPercentage: input.discountPercentage }
          : {}),
        ...(input.validFrom !== undefined
          ? { validFrom: input.validFrom }
          : {}),
        ...(input.validUntil !== undefined
          ? { validUntil: input.validUntil }
          : {}),
        ...(input.isActive !== undefined
          ? { isActive: input.isActive }
          : {}),
        ...(input.maxUsageCount !== undefined
          ? { maxUsageCount: input.maxUsageCount }
          : {}),
        ...(input.minInvoiceAmount !== undefined
          ? { minInvoiceAmount: input.minInvoiceAmount }
          : {}),
        ...(input.branchId !== undefined
          ? { branchId: input.branchId }
          : {}),
      },
      tx
    );
    await createAuditLog({
      tx,
      salonId: existing.salonId,
      branchId: updated.branchId,
      userId: audit.userId,
      module: "COUPON",
      action: "UPDATE",
      entityId: existing.id,
      entityCode: updated.couponCode,
      entityName: updated.couponCode,
      description: `Coupon ${updated.couponCode} updated`,
      oldData: safeCoupon(existing),
      newData: safeCoupon(updated),
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
    return updated;
  });
};

export const setCouponStatus = async (
  existing: Coupon,
  isActive: boolean,
  audit: AuditContext
) =>
  prisma.$transaction(async (tx) => {
    const updated = await CouponModel.update(
      existing.id,
      { isActive },
      tx
    );
    await createAuditLog({
      tx,
      salonId: existing.salonId,
      branchId: existing.branchId,
      userId: audit.userId,
      module: "COUPON",
      action: "STATUS_CHANGE",
      entityId: existing.id,
      entityCode: existing.couponCode,
      entityName: existing.couponCode,
      description: `Coupon ${existing.couponCode} ${
        isActive ? "activated" : "deactivated"
      }`,
      oldData: { isActive: existing.isActive },
      newData: { isActive },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
    return updated;
  });

export const deleteCoupon = async (
  existing: Coupon & { _count?: { invoices: number } },
  audit: AuditContext
) =>
  prisma.$transaction(async (tx) => {
    const mustSoftDelete =
      existing.usedCount > 0 || (existing._count?.invoices ?? 0) > 0;
    if (mustSoftDelete) {
      const updated = await CouponModel.update(
        existing.id,
        { isActive: false },
        tx
      );
      await createAuditLog({
        tx,
        salonId: existing.salonId,
        branchId: existing.branchId,
        userId: audit.userId,
        module: "COUPON",
        action: "DELETE",
        entityId: existing.id,
        entityCode: existing.couponCode,
        entityName: existing.couponCode,
        description: `Coupon ${existing.couponCode} soft-deleted`,
        oldData: safeCoupon(existing),
        newData: { ...safeCoupon(updated), isActive: false },
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
      });
      return { coupon: updated, softDeleted: true };
    }

    await CouponModel.remove(existing.id, tx);
    await createAuditLog({
      tx,
      salonId: existing.salonId,
      branchId: existing.branchId,
      userId: audit.userId,
      module: "COUPON",
      action: "DELETE",
      entityId: existing.id,
      entityCode: existing.couponCode,
      entityName: existing.couponCode,
      description: `Coupon ${existing.couponCode} deleted`,
      oldData: safeCoupon(existing),
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
    return { coupon: null, softDeleted: false };
  });

const ensureDraftInvoice = (invoice: Invoice) => {
  if (invoice.status === "CANCELLED") {
    throw new CouponServiceError(
      "Cancelled invoices cannot be changed",
      409
    );
  }
  if (
    invoice.status !== "DRAFT" ||
    invoice.paymentStatus !== "UNPAID" ||
    invoice.paidAmount.gt(0)
  ) {
    throw new CouponServiceError(
      "Only unpaid draft invoices can have coupon changes",
      409
    );
  }
};

const validateCouponForInvoice = (
  coupon: Coupon,
  invoice: Invoice,
  now: Date
) => {
  if (coupon.salonId !== invoice.salonId) {
    throw new CouponServiceError("Coupon is not valid for this salon", 400);
  }
  if (coupon.branchId && coupon.branchId !== invoice.branchId) {
    throw new CouponServiceError(
      "Coupon is not valid for this invoice branch",
      400
    );
  }
  if (!coupon.isActive) {
    throw new CouponServiceError("Coupon is inactive", 400);
  }
  if (now < coupon.validFrom) {
    throw new CouponServiceError("Coupon is not valid yet", 400);
  }
  if (now > coupon.validUntil) {
    throw new CouponServiceError("Coupon has expired", 400);
  }
  if (
    coupon.maxUsageCount !== null &&
    coupon.usedCount >= coupon.maxUsageCount
  ) {
    throw new CouponServiceError("Coupon usage limit reached", 400);
  }
};

const invoiceTaxPercent = (
  invoiceType: string,
  items: Array<{ taxPercent: Prisma.Decimal }>
) =>
  invoiceType === "GST_INVOICE"
    ? items.reduce(
        (highest, item) =>
          item.taxPercent.gt(highest) ? item.taxPercent : highest,
        new Prisma.Decimal(0)
      )
    : new Prisma.Decimal(0);

const recalculateDraftGst = async (
  tx: Prisma.TransactionClient,
  invoice: Invoice & {
    items: Array<{
      id: string;
      itemType: string;
      quantity: number;
      unitPrice: Prisma.Decimal;
      taxPercent: Prisma.Decimal;
    }>;
    salon: {
      gstEnabled: boolean;
      gstNumber: string | null;
      gstLegalName: string | null;
      gstStateCode: string | null;
      serviceGstRate: Prisma.Decimal;
      productGstRate: Prisma.Decimal;
    };
  },
  couponDiscountAmount = invoice.couponDiscountAmount
) => {
  const fallbackRate = invoice.items.reduce(
    (highest, item) => (item.taxPercent.gt(highest) ? item.taxPercent : highest),
    new Prisma.Decimal(0)
  );
  const settings =
    invoice.invoiceType === "GST_INVOICE" && fallbackRate.gt(0)
      ? {
          ...invoice.salon,
          gstEnabled: true,
          serviceGstRate: fallbackRate,
          productGstRate: fallbackRate,
        }
      : invoice.salon;
  const calculation = calculateInvoiceGst(
    {
      invoiceType: invoice.invoiceType,
      discountAmount: invoice.discountAmount,
      couponDiscountAmount,
      processingFeeAmount: invoice.processingFeeAmount,
      items: invoice.items,
    },
    settings
  );

  for (const [index, item] of invoice.items.entries()) {
    const line = calculation.lines[index];
    if (!line) continue;
    await tx.invoiceItem.update({
      where: { id: item.id },
      data: {
        taxableAmount: line.taxableAmount,
        gstRateSnapshot: line.gstRateSnapshot,
        gstAmount: line.gstAmount,
        totalWithTax: line.totalWithTax,
        taxPercent: line.taxPercent,
        taxAmount: line.taxAmount,
        lineTotal: line.lineTotal,
      },
    });
  }

  return calculation;
};

const updateCustomerLedgerForTotalChange = async (
  tx: Prisma.TransactionClient,
  invoice: Invoice,
  newTotal: Prisma.Decimal,
  narration: string
) => {
  const isUnpostedWalkInDraft = invoice.appointmentId
    ? await tx.appointment.findFirst({
        where: {
          id: invoice.appointmentId,
          walkInJobCart: true,
          source: "WALK_IN",
        },
        select: { id: true },
      })
    : null;
  if (isUnpostedWalkInDraft) return;
  const delta = newTotal.minus(invoice.totalAmount).toDecimalPlaces(2);
  if (delta.isZero()) return;

  await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${invoice.customerId} FOR UPDATE`;
  const customer = await tx.customer.update({
    where: { id: invoice.customerId },
    data: {
      outstandingAmount: delta.isPositive()
        ? { increment: delta }
        : { decrement: delta.abs() },
    },
    select: { outstandingAmount: true },
  });
  await tx.customerTransaction.create({
    data: {
      customerId: invoice.customerId,
      salonId: invoice.salonId,
      invoiceId: invoice.id,
      billNo: invoice.invoiceCode,
      narration,
      type: "ADJUSTMENT",
      debit: delta.isPositive() ? delta : new Prisma.Decimal(0),
      credit: delta.isNegative() ? delta.abs() : new Prisma.Decimal(0),
      balanceAfter: customer.outstandingAmount,
      status: "COMPLETE",
    },
  });
};

const invoiceCouponAudit = (invoice: {
  couponId: string | null;
  couponCodeSnapshot: string | null;
  couponDiscountAmount: unknown;
  taxAmount: unknown;
  totalAmount: unknown;
  balanceAmount: unknown;
}) => ({
  couponId: invoice.couponId,
  couponCode: invoice.couponCodeSnapshot,
  couponDiscountAmount: invoice.couponDiscountAmount,
  taxAmount: invoice.taxAmount,
  totalAmount: invoice.totalAmount,
  balanceAmount: invoice.balanceAmount,
});

export const applyCouponToInvoice = async (input: {
  invoiceId: string;
  couponCode: string;
  salonId?: string;
  actorBranchId?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}) =>
  prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${input.invoiceId} FOR UPDATE`;
    const invoice = await tx.invoice.findFirst({
      where: {
        id: input.invoiceId,
        ...(input.salonId ? { salonId: input.salonId } : {}),
      },
      include: {
        items: true,
        salon: {
          select: {
            gstEnabled: true,
            gstNumber: true,
            gstLegalName: true,
            gstStateCode: true,
            serviceGstRate: true,
            productGstRate: true,
          },
        },
      },
    });
    if (!invoice) {
      throw new CouponServiceError("Invoice not found", 404);
    }
    if (
      input.actorBranchId &&
      invoice.branchId !== input.actorBranchId
    ) {
      throw new CouponServiceError("Invoice not found", 404);
    }
    ensureDraftInvoice(invoice);

    const coupon = await tx.coupon.findFirst({
      where: {
        salonId: invoice.salonId,
        couponCode: input.couponCode,
      },
    });
    if (!coupon) {
      throw new CouponServiceError("Invalid coupon", 404);
    }
    await tx.$queryRaw`SELECT "id" FROM "Coupon" WHERE "id" = ${coupon.id} FOR UPDATE`;
    validateCouponForInvoice(coupon, invoice, new Date());

    const eligibleAmount = Prisma.Decimal.max(
      invoice.subtotalAmount.minus(invoice.discountAmount),
      0
    ).toDecimalPlaces(2);
    if (
      coupon.minInvoiceAmount !== null &&
      eligibleAmount.lt(coupon.minInvoiceAmount)
    ) {
      throw new CouponServiceError(
        "Minimum invoice amount not met",
        400
      );
    }
    const couponDiscountAmount = Prisma.Decimal.min(
      eligibleAmount
        .mul(coupon.discountPercentage)
        .div(100)
        .toDecimalPlaces(2),
      eligibleAmount
    );
    const calculation = await recalculateDraftGst(
      tx,
      invoice,
      couponDiscountAmount
    );
    const taxAmount = calculation.totalGstAmount;
    const totalAmount = calculation.totalAmount;
    const balanceAmount = totalAmount
      .minus(invoice.paidAmount)
      .toDecimalPlaces(2);

    await updateCustomerLedgerForTotalChange(
      tx,
      invoice,
      totalAmount,
      `Coupon ${coupon.couponCode} applied to invoice ${invoice.invoiceCode}`
    );
    const updated = await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        couponId: coupon.id,
        couponCodeSnapshot: coupon.couponCode,
        couponDiscountAmount,
        serviceTaxableAmount: calculation.serviceTaxableAmount,
        productTaxableAmount: calculation.productTaxableAmount,
        serviceGstAmount: calculation.serviceGstAmount,
        productGstAmount: calculation.productGstAmount,
        totalGstAmount: calculation.totalGstAmount,
        gstNumberSnapshot: calculation.gstNumberSnapshot,
        gstLegalNameSnapshot: calculation.gstLegalNameSnapshot,
        gstStateCodeSnapshot: calculation.gstStateCodeSnapshot,
        gstEnabledSnapshot: calculation.gstEnabledSnapshot,
        taxAmount,
        totalAmount,
        balanceAmount,
      },
      include: { items: true, payments: true, coupon: true },
    });
    await createAuditLog({
      tx,
      salonId: invoice.salonId,
      branchId: invoice.branchId,
      userId: input.userId,
      module: "COUPON",
      action: "UPDATE",
      entityId: coupon.id,
      entityCode: invoice.invoiceCode,
      entityName: coupon.couponCode,
      description: `Coupon ${coupon.couponCode} applied to invoice ${invoice.invoiceCode}`,
      oldData: {
        invoiceId: invoice.id,
        invoiceCode: invoice.invoiceCode,
        ...invoiceCouponAudit(invoice),
      },
      newData: {
        invoiceId: invoice.id,
        invoiceCode: invoice.invoiceCode,
        discountPercentage: coupon.discountPercentage,
        ...invoiceCouponAudit(updated),
      },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return updated;
  });

export const removeCouponFromInvoice = async (input: {
  invoiceId: string;
  salonId?: string;
  actorBranchId?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}) =>
  prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${input.invoiceId} FOR UPDATE`;
    const invoice = await tx.invoice.findFirst({
      where: {
        id: input.invoiceId,
        ...(input.salonId ? { salonId: input.salonId } : {}),
      },
      include: {
        items: true,
        salon: {
          select: {
            gstEnabled: true,
            gstNumber: true,
            gstLegalName: true,
            gstStateCode: true,
            serviceGstRate: true,
            productGstRate: true,
          },
        },
      },
    });
    if (!invoice) {
      throw new CouponServiceError("Invoice not found", 404);
    }
    if (
      input.actorBranchId &&
      invoice.branchId !== input.actorBranchId
    ) {
      throw new CouponServiceError("Invoice not found", 404);
    }
    ensureDraftInvoice(invoice);
    if (!invoice.couponId || !invoice.couponCodeSnapshot) {
      throw new CouponServiceError(
        "Invoice does not have an applied coupon",
        409
      );
    }

    const eligibleAmount = Prisma.Decimal.max(
      invoice.subtotalAmount.minus(invoice.discountAmount),
      0
    ).toDecimalPlaces(2);
    const calculation = await recalculateDraftGst(
      tx,
      invoice,
      new Prisma.Decimal(0)
    );
    const taxAmount = calculation.totalGstAmount;
    const totalAmount = calculation.totalAmount;
    const balanceAmount = totalAmount
      .minus(invoice.paidAmount)
      .toDecimalPlaces(2);
    const removedCouponId = invoice.couponId;
    const removedCouponCode = invoice.couponCodeSnapshot;

    await updateCustomerLedgerForTotalChange(
      tx,
      invoice,
      totalAmount,
      `Coupon ${removedCouponCode} removed from invoice ${invoice.invoiceCode}`
    );
    const updated = await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        couponId: null,
        couponCodeSnapshot: null,
        couponDiscountAmount: 0,
        serviceTaxableAmount: calculation.serviceTaxableAmount,
        productTaxableAmount: calculation.productTaxableAmount,
        serviceGstAmount: calculation.serviceGstAmount,
        productGstAmount: calculation.productGstAmount,
        totalGstAmount: calculation.totalGstAmount,
        gstNumberSnapshot: calculation.gstNumberSnapshot,
        gstLegalNameSnapshot: calculation.gstLegalNameSnapshot,
        gstStateCodeSnapshot: calculation.gstStateCodeSnapshot,
        gstEnabledSnapshot: calculation.gstEnabledSnapshot,
        taxAmount,
        totalAmount,
        balanceAmount,
      },
      include: { items: true, payments: true, coupon: true },
    });
    await createAuditLog({
      tx,
      salonId: invoice.salonId,
      branchId: invoice.branchId,
      userId: input.userId,
      module: "COUPON",
      action: "DELETE",
      entityId: removedCouponId,
      entityCode: invoice.invoiceCode,
      entityName: removedCouponCode,
      description: `Coupon ${removedCouponCode} removed from invoice ${invoice.invoiceCode}`,
      oldData: {
        invoiceId: invoice.id,
        invoiceCode: invoice.invoiceCode,
        ...invoiceCouponAudit(invoice),
      },
      newData: {
        invoiceId: invoice.id,
        invoiceCode: invoice.invoiceCode,
        ...invoiceCouponAudit(updated),
      },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return updated;
  });

export const issueInvoice = async (input: {
  invoiceId: string;
  salonId?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  tx?: Prisma.TransactionClient;
  allowWalkInJobCart?: boolean;
}) => {
  const run = async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${input.invoiceId} FOR UPDATE`;
    const invoice = await tx.invoice.findFirst({
      where: {
        id: input.invoiceId,
        ...(input.salonId ? { salonId: input.salonId } : {}),
      },
      include: {
        items: true,
        salon: {
          select: {
            gstEnabled: true,
            gstNumber: true,
            gstLegalName: true,
            gstStateCode: true,
            serviceGstRate: true,
            productGstRate: true,
          },
        },
      },
    });
    if (!invoice) {
      throw new CouponServiceError("Invoice not found", 404);
    }
    if (invoice.appointmentId && !input.allowWalkInJobCart) {
      const walkInAppointment = await tx.appointment.findFirst({
        where: {
          id: invoice.appointmentId,
          walkInJobCart: true,
          source: "WALK_IN",
          status: { not: "COMPLETED" },
        },
        select: { id: true },
      });
      if (walkInAppointment) {
        throw new CouponServiceError(
          "Confirm the job cart to issue this invoice",
          409
        );
      }
    }
    if (invoice.status !== "DRAFT") {
      throw new CouponServiceError(
        "Only draft invoices can be issued",
        409
      );
    }
    if (invoice.paymentStatus !== "UNPAID" || invoice.paidAmount.gt(0)) {
      throw new CouponServiceError(
        "Paid invoices cannot be issued from draft",
        409
      );
    }

    if (invoice.couponId) {
      await tx.$queryRaw`SELECT "id" FROM "Coupon" WHERE "id" = ${invoice.couponId} FOR UPDATE`;
      const coupon = await tx.coupon.findUnique({
        where: { id: invoice.couponId },
      });
      if (!coupon) {
        throw new CouponServiceError("Applied coupon no longer exists", 409);
      }
      validateCouponForInvoice(coupon, invoice, new Date());
      await tx.coupon.update({
        where: { id: coupon.id },
        data: { usedCount: { increment: 1 } },
      });
    }

    const calculation = await recalculateDraftGst(tx, invoice);
    const updated = await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "ISSUED",
        serviceTaxableAmount: calculation.serviceTaxableAmount,
        productTaxableAmount: calculation.productTaxableAmount,
        serviceGstAmount: calculation.serviceGstAmount,
        productGstAmount: calculation.productGstAmount,
        totalGstAmount: calculation.totalGstAmount,
        gstNumberSnapshot: calculation.gstNumberSnapshot,
        gstLegalNameSnapshot: calculation.gstLegalNameSnapshot,
        gstStateCodeSnapshot: calculation.gstStateCodeSnapshot,
        gstEnabledSnapshot: calculation.gstEnabledSnapshot,
        taxAmount: calculation.totalGstAmount,
        roundOffAmount: calculation.roundOffAmount,
        totalAmount: calculation.totalAmount,
        balanceAmount: calculation.totalAmount.minus(invoice.paidAmount).toDecimalPlaces(2),
      },
      include: { items: true, payments: true, coupon: true },
    });
    const ledgerExists = await tx.customerTransaction.findFirst({
      where: {
        invoiceId: invoice.id,
        type: "INVOICE",
      },
      select: { id: true },
    });
    if (!ledgerExists && updated.totalAmount.gt(0)) {
      await CustomerModel.increaseOutstandingWithTransaction(
        {
          customerId: updated.customerId,
          salonId: updated.salonId,
          invoiceId: updated.id,
          billNo: updated.invoiceCode,
          amount: updated.totalAmount,
          narration: `Invoice issued: ${updated.invoiceCode}`,
        },
        tx
      );
    }
    await createAuditLog({
      tx,
      salonId: invoice.salonId,
      branchId: invoice.branchId,
      userId: input.userId,
      module: "INVOICE",
      action: "STATUS_CHANGE",
      entityId: invoice.id,
      entityCode: invoice.invoiceCode,
      entityName: invoice.customerName,
      description: `Invoice ${invoice.invoiceCode} issued`,
      oldData: { status: invoice.status },
      newData: {
        status: updated.status,
        couponId: updated.couponId,
        couponCode: updated.couponCodeSnapshot,
        serviceTaxableAmount: updated.serviceTaxableAmount,
        productTaxableAmount: updated.productTaxableAmount,
        serviceGstAmount: updated.serviceGstAmount,
        productGstAmount: updated.productGstAmount,
        totalGstAmount: updated.totalGstAmount,
        gstEnabledSnapshot: updated.gstEnabledSnapshot,
      },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return updated;
  };
  return input.tx ? run(input.tx) : prisma.$transaction(run);
};
