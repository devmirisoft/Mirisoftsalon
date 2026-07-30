import { prisma } from "../../../config/prisma.js";
import type { AiTool } from "../ai-tool.types.js";
import { aiExactBranchScope } from "../ai-permission.service.js";

const MAX_CUSTOMERS = 10;

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

export const getOutstandingCustomersTool: AiTool = {
  name: "getOutstandingCustomers",
  description: "Returns a summary of customers with an outstanding balance.",
  allowedRoles: [
    "SUPER_ADMIN",
    "SALON_ADMIN",
    "BRANCH_MANAGER",
    "RECEPTIONIST",
  ],

  async run({ context }) {
    const where = {
      ...(context.salonId ? { salonId: context.salonId } : {}),
      ...aiExactBranchScope(context),
      outstandingAmount: { gt: 0 },
    };
    const [customers, aggregate, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        select: {
          id: true,
          customerCode: true,
          name: true,
          branchId: true,
          outstandingAmount: true,
        },
        orderBy: { outstandingAmount: "desc" },
        take: MAX_CUSTOMERS,
      }),
      prisma.customer.aggregate({
        where,
        _sum: { outstandingAmount: true },
      }),
      prisma.customer.count({ where }),
    ]);
    const totalOutstanding = Number(aggregate._sum.outstandingAmount ?? 0);

    return {
      summary: `${total} customer${
        total === 1 ? " has" : "s have"
      } ${inr.format(totalOutstanding)} outstanding in total.`,
      data: {
        totalCustomers: total,
        totalOutstanding,
        currency: "INR",
        customers: customers.map((customer) => ({
          ...customer,
          outstandingAmount: Number(customer.outstandingAmount),
        })),
        truncated: total > customers.length,
      },
      cards: [
        {
          type: total > 0 ? "WARNING" : "METRIC",
          title: "Pending balances",
          value: inr.format(totalOutstanding),
          description: `${total} customer${total === 1 ? "" : "s"}`,
        },
      ],
      table: {
        columns: [
          { key: "customerCode", label: "Code" },
          { key: "name", label: "Customer" },
          { key: "outstandingAmount", label: "Outstanding" },
        ],
        rows: customers.map((customer) => ({
          customerCode: customer.customerCode,
          name: customer.name,
          outstandingAmount: Number(customer.outstandingAmount),
          branchId: customer.branchId,
        })),
      },
      warnings:
        total > 0
          ? [`${total} customer${total === 1 ? " has" : "s have"} pending balances.`]
          : undefined,
    };
  },
};
