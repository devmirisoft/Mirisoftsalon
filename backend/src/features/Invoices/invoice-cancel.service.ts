import { Prisma } from "../../generated/prisma/client.js";
import { createAuditLog } from "../audit-logs/audit-log.service.js";
import { reverseUsedPackageUsagesForInvoice } from "../packages/package.service.js";
import { reverseAppointmentConsumables } from "../stock/appointmentConsumableReversal.service.js";
import { InvoiceModel } from "./invoice.model.js";

/**
 * Cancels an unpaid invoice and undoes everything it booked: coupon use,
 * consumables, package redemptions and sold packages, and whatever it added to
 * the customer's outstanding. Shared by the invoice cancel route and appointment
 * cancellation, so a cancelled appointment never leaves a live bill behind.
 */
export const cancelInvoiceInTransaction = async (
  tx: Prisma.TransactionClient,
  id: string,
  context: {
    userId?: string | undefined;
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
  }
) => {
  await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${id} FOR UPDATE`;
  const current = await tx.invoice.findUniqueOrThrow({ where: { id } });
  if (current.status === "CANCELLED") {
    throw Object.assign(new Error("Invoice is already cancelled"), {
      status: 409,
    });
  }
  if (current.paymentStatus !== "UNPAID") {
    throw Object.assign(
      new Error("Paid or partially paid invoice cannot be cancelled"),
      { status: 400 }
    );
  }
  if (current.couponId && current.status === "ISSUED") {
    await tx.$queryRaw`SELECT "id" FROM "Coupon" WHERE "id" = ${current.couponId} FOR UPDATE`;
    await tx.coupon.updateMany({
      where: { id: current.couponId, usedCount: { gt: 0 } },
      data: { usedCount: { decrement: 1 } },
    });
  }
  if (current.appointmentId) {
    await reverseAppointmentConsumables({
      tx,
      appointmentId: current.appointmentId,
      salonId: current.salonId,
      branchId: current.branchId,
      createdById: context.userId,
    });
  }
  const cancelled = await InvoiceModel.cancel(id, tx);
  await reverseUsedPackageUsagesForInvoice(tx, { invoiceId: id, ...context });

  // An issued invoice debited the customer's outstanding; credit back whatever
  // is still owed on it so the cancelled bill stops counting as due.
  const ledger = await tx.customerTransaction.aggregate({
    where: { invoiceId: id },
    _sum: { debit: true, credit: true },
  });
  const owed = (ledger._sum.debit ?? new Prisma.Decimal(0)).minus(
    ledger._sum.credit ?? 0
  );
  if (owed.gt(0)) {
    await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${current.customerId} FOR UPDATE`;
    const customer = await tx.customer.update({
      where: { id: current.customerId },
      data: { outstandingAmount: { decrement: owed } },
      select: { outstandingAmount: true },
    });
    await tx.customerTransaction.create({
      data: {
        customerId: current.customerId,
        salonId: current.salonId,
        invoiceId: id,
        billNo: current.invoiceCode,
        narration: `Invoice cancelled: ${current.invoiceCode}`,
        type: "ADJUSTMENT",
        debit: 0,
        credit: owed,
        balanceAfter: customer.outstandingAmount,
        status: "COMPLETE",
      },
    });
  }

  const customerPackages = await tx.customerPackage.findMany({
    where: { invoiceId: id, status: { not: "CANCELLED" } },
  });
  if (customerPackages.length) {
    await tx.customerPackage.updateMany({
      where: { id: { in: customerPackages.map((item) => item.id) } },
      data: { status: "CANCELLED" },
    });
    for (const customerPackage of customerPackages) {
      await createAuditLog({
        tx,
        salonId: customerPackage.salonId,
        branchId: customerPackage.branchId,
        userId: context.userId,
        module: "PACKAGE",
        action: "CANCEL",
        entityId: customerPackage.id,
        entityName: customerPackage.packageNameSnapshot,
        description: `Customer package ${customerPackage.packageNameSnapshot} cancelled with invoice ${cancelled.invoiceCode}`,
        oldData: { status: customerPackage.status },
        newData: { status: "CANCELLED", invoiceId: id },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
    }
  }
  await createAuditLog({
    tx,
    salonId: current.salonId,
    branchId: current.branchId,
    userId: context.userId,
    module: "INVOICE",
    action: "CANCEL",
    entityId: cancelled.id,
    entityCode: cancelled.invoiceCode,
    entityName: cancelled.customerName,
    description: `Invoice ${cancelled.invoiceCode} cancelled`,
    oldData: { status: current.status },
    newData: { status: cancelled.status },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });
  return cancelled;
};
