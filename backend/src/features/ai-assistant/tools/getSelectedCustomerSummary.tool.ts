import { prisma } from "../../../config/prisma.js";
import type { AiTool } from "../ai-tool.types.js";
import { aiExactBranchScope } from "../ai-permission.service.js";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

export const getSelectedCustomerSummaryTool: AiTool = {
  name: "getSelectedCustomerSummary",
  description: "Returns a minimized summary for the selected customer.",
  allowedRoles: [
    "SUPER_ADMIN",
    "SALON_ADMIN",
    "BRANCH_MANAGER",
    "RECEPTIONIST",
    "STAFF",
  ],

  async run({ context, uiContext }) {
    const selected = uiContext?.selectedEntity;
    if (selected?.type !== "CUSTOMER") {
      return {
        summary: "Open a customer record first, then ask about this customer.",
        warnings: ["No selected customer was provided by the current screen."],
      };
    }

    const customer = await prisma.customer.findFirst({
      where: {
        id: selected.id,
        ...aiExactBranchScope(context),
      },
      select: {
        id: true,
        customerCode: true,
        name: true,
        status: true,
        outstandingAmount: true,
        walletBalance: true,
        loyaltyPoints: true,
        customNotes: true,
        appointments: {
          select: {
            appointmentCode: true,
            startTime: true,
            status: true,
            services: { select: { serviceName: true } },
          },
          orderBy: { startTime: "desc" },
          take: 8,
        },
        invoices: {
          select: {
            id: true,
            invoiceCode: true,
            invoiceDate: true,
            totalAmount: true,
            balanceAmount: true,
            paymentStatus: true,
          },
          orderBy: { invoiceDate: "desc" },
          take: 3,
        },
        customerPackages: {
          where: { status: "ACTIVE" },
          select: { packageNameSnapshot: true, validUntil: true },
          orderBy: { validUntil: "asc" },
          take: 3,
        },
        membershipHistory: {
          where: { status: "ACTIVE" },
          select: { membershipNameSnapshot: true, expiresAt: true },
          orderBy: { expiresAt: "asc" },
          take: 3,
        },
      },
    });

    if (!customer) {
      return {
        summary: "I could not find that customer within your allowed salon and branch scope.",
        warnings: ["The selected customer is unavailable or outside your access."],
      };
    }

    const upcoming = customer.appointments.filter(
      (appointment) => appointment.startTime >= new Date()
    );
    const lastVisit = customer.appointments.find(
      (appointment) => appointment.startTime < new Date()
    );
    const serviceCounts = new Map<string, number>();
    customer.appointments.forEach((appointment) => {
      appointment.services.forEach((service) => {
        serviceCounts.set(
          service.serviceName,
          (serviceCounts.get(service.serviceName) ?? 0) + 1
        );
      });
    });
    const commonServices = [...serviceCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name]) => name);
    const outstanding = Number(customer.outstandingAmount);

    return {
      summary: `${customer.name} has ${customer.appointments.length} recent visit record${
        customer.appointments.length === 1 ? "" : "s"
      }, ${upcoming.length} upcoming booking${
        upcoming.length === 1 ? "" : "s"
      }, and ${inr.format(outstanding)} outstanding.`,
      data: {
        customer: {
          id: customer.id,
          customerCode: customer.customerCode,
          name: customer.name,
          status: customer.status,
          outstandingAmount: outstanding,
          walletBalance: Number(customer.walletBalance),
          loyaltyPoints: customer.loyaltyPoints,
          lastVisitDate: lastVisit?.startTime.toISOString(),
          upcomingBookings: upcoming.length,
          commonServices,
          activePackages: customer.customerPackages,
          activeMemberships: customer.membershipHistory,
          hasPreferences: Boolean(customer.customNotes),
        },
      },
      cards: [
        {
          type: "ENTITY",
          title: customer.name,
          value: customer.customerCode,
          entityType: "CUSTOMER",
          entityId: customer.id,
        },
        {
          type: outstanding > 0 ? "WARNING" : "METRIC",
          title: "Outstanding",
          value: inr.format(outstanding),
          description:
            outstanding > 0 ? "Review balance before the next visit." : "No balance is due.",
        },
      ],
      table: {
        columns: [
          { key: "invoiceCode", label: "Invoice" },
          { key: "paymentStatus", label: "Payment" },
          { key: "balanceAmount", label: "Balance" },
        ],
        rows: customer.invoices.map((invoice) => ({
          invoiceCode: invoice.invoiceCode,
          paymentStatus: invoice.paymentStatus,
          balanceAmount: Number(invoice.balanceAmount),
          invoiceId: invoice.id,
        })),
      },
      suggestedActions: [
        {
          id: "open-customer",
          label: "Open customer",
          actionType: "OPEN_ENTITY",
          requiresConfirmation: false,
          payload: { entityType: "CUSTOMER", entityId: customer.id },
        },
      ],
      warnings:
        outstanding > 0
          ? ["This customer has an outstanding balance."]
          : undefined,
    };
  },
};
