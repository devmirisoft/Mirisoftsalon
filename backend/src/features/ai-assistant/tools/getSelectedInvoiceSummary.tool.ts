import { prisma } from "../../../config/prisma.js";
import type { AiTool } from "../ai-tool.types.js";
import { aiExactBranchScope } from "../ai-permission.service.js";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

export const getSelectedInvoiceSummaryTool: AiTool = {
  name: "getSelectedInvoiceSummary",
  description: "Explains the selected invoice using minimized billing fields.",
  allowedRoles: ["SUPER_ADMIN", "SALON_ADMIN", "RECEPTIONIST", "STAFF"],

  async run({ context, uiContext }) {
    const selected = uiContext?.selectedEntity;
    if (selected?.type !== "INVOICE") {
      return {
        summary: "Open an invoice first, then ask me to explain this bill.",
        warnings: ["No selected invoice was provided by the current screen."],
      };
    }

    const invoice = await prisma.invoice.findFirst({
      where: {
        id: selected.id,
        ...aiExactBranchScope(context),
      },
      select: {
        id: true,
        invoiceCode: true,
        customerName: true,
        invoiceDate: true,
        subtotalAmount: true,
        discountAmount: true,
        couponDiscountAmount: true,
        taxAmount: true,
        processingFeeAmount: true,
        totalAmount: true,
        paidAmount: true,
        balanceAmount: true,
        status: true,
        paymentStatus: true,
        items: {
          select: {
            serviceName: true,
            itemType: true,
            quantity: true,
            unitPrice: true,
            discountAmount: true,
            taxAmount: true,
            lineTotal: true,
          },
          take: 20,
        },
        payments: {
          select: { amount: true, method: true, paidAt: true },
          orderBy: { paidAt: "desc" },
          take: 10,
        },
      },
    });

    if (!invoice) {
      return {
        summary: "I could not find that invoice within your allowed salon and branch scope.",
        warnings: ["The selected invoice is unavailable or outside your access."],
      };
    }

    const balance = Number(invoice.balanceAmount);
    return {
      summary: `${invoice.invoiceCode} totals ${inr.format(
        Number(invoice.totalAmount)
      )}. ${inr.format(Number(invoice.paidAmount))} is paid and ${inr.format(
        balance
      )} remains due.`,
      data: {
        invoice: {
          id: invoice.id,
          invoiceCode: invoice.invoiceCode,
          customerName: invoice.customerName,
          invoiceDate: invoice.invoiceDate.toISOString(),
          subtotalAmount: Number(invoice.subtotalAmount),
          discountAmount: Number(invoice.discountAmount),
          couponDiscountAmount: Number(invoice.couponDiscountAmount),
          taxAmount: Number(invoice.taxAmount),
          processingFeeAmount: Number(invoice.processingFeeAmount),
          totalAmount: Number(invoice.totalAmount),
          paidAmount: Number(invoice.paidAmount),
          balanceAmount: balance,
          status: invoice.status,
          paymentStatus: invoice.paymentStatus,
        },
        payments: invoice.payments.map((payment) => ({
          amount: Number(payment.amount),
          method: payment.method,
          paidAt: payment.paidAt.toISOString(),
        })),
      },
      cards: [
        {
          type: "METRIC",
          title: "Invoice total",
          value: inr.format(Number(invoice.totalAmount)),
        },
        {
          type: balance > 0 ? "WARNING" : "METRIC",
          title: "Balance",
          value: inr.format(balance),
          description: invoice.paymentStatus,
        },
      ],
      table: {
        columns: [
          { key: "serviceName", label: "Item" },
          { key: "quantity", label: "Qty" },
          { key: "lineTotal", label: "Total" },
        ],
        rows: invoice.items.map((item) => ({
          serviceName: item.serviceName,
          itemType: item.itemType,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          discountAmount: Number(item.discountAmount),
          taxAmount: Number(item.taxAmount),
          lineTotal: Number(item.lineTotal),
        })),
      },
      suggestedActions: [
        {
          id: "open-invoice",
          label: "Open invoice",
          actionType: "OPEN_ENTITY",
          requiresConfirmation: false,
          payload: { entityType: "INVOICE", entityId: invoice.id },
        },
      ],
      warnings:
        balance > 0 ? ["This invoice still has an unpaid balance."] : undefined,
    };
  },
};
