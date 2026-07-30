import { prisma } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { awardInvoiceLoyaltyInTransaction } from "../Invoices/invoice-retention.service.js";
import { createAuditLog } from "../audit-logs/audit-log.service.js";
export class PaymentConflictError extends Error {
}
export const PaymentModel = {
    createAndUpdateInvoice: async (data) => {
        return prisma.$transaction(async (tx) => {
            await tx.$queryRaw `SELECT "id" FROM "Invoice" WHERE "id" = ${data.invoiceId} FOR UPDATE`;
            const lockedInvoice = await tx.invoice.findUnique({
                where: { id: data.invoiceId },
            });
            if (!lockedInvoice || lockedInvoice.salonId !== data.salonId) {
                throw new PaymentConflictError("Invoice not found");
            }
            if (lockedInvoice.status === "CANCELLED") {
                throw new PaymentConflictError("Cannot add payment to cancelled invoice");
            }
            if (lockedInvoice.appointmentId) {
                const appointment = await tx.appointment.findUnique({
                    where: { id: lockedInvoice.appointmentId },
                    select: { status: true },
                });
                if (appointment?.status === "CANCELLED") {
                    throw new PaymentConflictError("Cannot add payment to a cancelled appointment or job cart");
                }
            }
            if (lockedInvoice.status === "DRAFT") {
                throw new PaymentConflictError("Draft invoice must be issued before payment");
            }
            if (lockedInvoice.paymentStatus === "PAID") {
                throw new PaymentConflictError("Invoice is already fully paid");
            }
            const paymentAmount = new Prisma.Decimal(data.amount).toDecimalPlaces(2);
            const currentPaidAmount = lockedInvoice.paidAmount;
            const currentBalanceAmount = lockedInvoice.balanceAmount;
            const totalAmount = lockedInvoice.totalAmount;
            if (paymentAmount.gt(currentBalanceAmount)) {
                throw new PaymentConflictError("Payment amount cannot be greater than invoice balance");
            }
            const newPaidAmount = currentPaidAmount.plus(paymentAmount).toDecimalPlaces(2);
            const newBalanceAmount = totalAmount.minus(newPaidAmount).toDecimalPlaces(2);
            const newPaymentStatus = newBalanceAmount.lte(0) ? "PAID" : "PARTIALLY_PAID";
            const payment = await tx.payment.create({
                data: {
                    salonId: data.salonId,
                    ...(data.branchId ? { branchId: data.branchId } : {}),
                    customerId: data.customerId,
                    invoiceId: data.invoiceId,
                    amount: data.amount,
                    method: data.method,
                    ...(data.referenceNo ? { referenceNo: data.referenceNo } : {}),
                    ...(data.note ? { note: data.note } : {}),
                    ...(data.paidAt ? { paidAt: data.paidAt } : {}),
                },
                include: {
                    salon: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                    branch: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                    customer: {
                        select: {
                            id: true,
                            name: true,
                            phone: true,
                            customerCode: true,
                        },
                    },
                    invoice: {
                        select: {
                            id: true,
                            invoiceCode: true,
                            totalAmount: true,
                            paidAmount: true,
                            balanceAmount: true,
                            paymentStatus: true,
                        },
                    },
                },
            });
            const invoice = await tx.invoice.update({
                where: {
                    id: data.invoiceId,
                },
                data: {
                    paidAmount: newPaidAmount,
                    balanceAmount: newBalanceAmount,
                    paymentStatus: newPaymentStatus,
                },
                include: {
                    items: true,
                    payments: true,
                },
            });
            const customer = await tx.customer.update({
                where: { id: data.customerId },
                data: { outstandingAmount: { decrement: paymentAmount } },
            });
            await tx.customerTransaction.create({
                data: {
                    customerId: data.customerId,
                    salonId: data.salonId,
                    invoiceId: data.invoiceId,
                    paymentId: payment.id,
                    billNo: lockedInvoice.invoiceCode,
                    narration: `Payment received via ${data.method}`,
                    type: "PAYMENT",
                    debit: 0,
                    credit: paymentAmount,
                    balanceAfter: customer.outstandingAmount,
                    status: "COMPLETE",
                },
            });
            const loyalty = newPaymentStatus === "PAID"
                ? await awardInvoiceLoyaltyInTransaction(tx, {
                    invoiceId: lockedInvoice.id,
                    salonId: lockedInvoice.salonId,
                    customerId: lockedInvoice.customerId,
                    finalPaidAmount: Number(newPaidAmount),
                    ...(data.createdById
                        ? { createdById: data.createdById }
                        : {}),
                })
                : null;
            await createAuditLog({
                tx,
                salonId: data.salonId,
                branchId: data.branchId,
                userId: data.createdById,
                module: "PAYMENT",
                action: "PAYMENT_RECORDED",
                entityId: payment.id,
                entityCode: lockedInvoice.invoiceCode,
                entityName: payment.customer.name,
                description: `Payment recorded for invoice ${lockedInvoice.invoiceCode}`,
                oldData: {
                    paidAmount: currentPaidAmount,
                    balanceAmount: currentBalanceAmount,
                    paymentStatus: lockedInvoice.paymentStatus,
                },
                newData: {
                    amount: paymentAmount,
                    method: data.method,
                    paidAmount: newPaidAmount,
                    balanceAmount: newBalanceAmount,
                    paymentStatus: newPaymentStatus,
                },
                ipAddress: data.ipAddress,
                userAgent: data.userAgent,
            });
            return {
                payment,
                invoice,
                loyalty,
            };
        });
    },
    findAll: async () => {
        return prisma.payment.findMany({
            include: {
                salon: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                branch: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                customer: {
                    select: {
                        id: true,
                        name: true,
                        phone: true,
                        customerCode: true,
                    },
                },
                invoice: {
                    select: {
                        id: true,
                        invoiceCode: true,
                        totalAmount: true,
                        paidAmount: true,
                        balanceAmount: true,
                        paymentStatus: true,
                    },
                },
            },
            orderBy: {
                paidAt: "desc",
            },
        });
    },
    findBySalon: async (salonId, filters) => {
        return prisma.payment.findMany({
            where: {
                salonId,
                ...(filters?.branchId ? { branchId: filters.branchId } : {}),
                ...(filters?.customerId ? { customerId: filters.customerId } : {}),
                ...(filters?.invoiceId ? { invoiceId: filters.invoiceId } : {}),
                ...(filters?.method ? { method: filters.method } : {}),
            },
            include: {
                branch: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                customer: {
                    select: {
                        id: true,
                        name: true,
                        phone: true,
                        customerCode: true,
                    },
                },
                invoice: {
                    select: {
                        id: true,
                        invoiceCode: true,
                        totalAmount: true,
                        paidAmount: true,
                        balanceAmount: true,
                        paymentStatus: true,
                    },
                },
            },
            orderBy: {
                paidAt: "desc",
            },
        });
    },
    findById: async (id) => {
        return prisma.payment.findUnique({
            where: {
                id,
            },
            include: {
                salon: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                branch: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                customer: {
                    select: {
                        id: true,
                        name: true,
                        phone: true,
                        customerCode: true,
                    },
                },
                invoice: {
                    select: {
                        id: true,
                        invoiceCode: true,
                        totalAmount: true,
                        paidAmount: true,
                        balanceAmount: true,
                        paymentStatus: true,
                    },
                },
            },
        });
    },
    findByIdAndSalon: async (id, salonId) => {
        return prisma.payment.findFirst({
            where: {
                id,
                salonId,
            },
            include: {
                branch: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                customer: {
                    select: {
                        id: true,
                        name: true,
                        phone: true,
                        customerCode: true,
                    },
                },
                invoice: {
                    select: {
                        id: true,
                        invoiceCode: true,
                        totalAmount: true,
                        paidAmount: true,
                        balanceAmount: true,
                        paymentStatus: true,
                    },
                },
            },
        });
    },
};
