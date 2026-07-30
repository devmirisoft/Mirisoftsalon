import { prisma } from "../../../config/prisma.js";
import { AppointmentStatus } from "../../../generated/prisma/enums.js";
import { parseSalonDateRange } from "../../../utils/timezone.js";
import type {
  AiTool,
  AiToolContext,
  AiToolResult,
  DailyBriefResponse,
} from "../ai-tool.types.js";
import {
  aiExactBranchScope,
  aiSharedBranchScope,
} from "../ai-permission.service.js";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const localDate = (date: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

export const salonTodayRange = async (
  context: AiToolContext
): Promise<{ date: string; timezone: string; start: Date; end: Date }> => {
  const salon = context.salonId
    ? await prisma.salon.findUnique({
        where: { id: context.salonId },
        select: { timezone: true },
      })
    : null;
  const timezone = salon?.timezone ?? context.timezone ?? "Asia/Kolkata";
  const date = localDate(new Date(), timezone);
  const range = parseSalonDateRange(date, date, timezone);
  if (!range.start || !range.end) {
    throw new Error("Unable to determine the salon day");
  }
  return { date, timezone, start: range.start, end: range.end };
};

const staffIdForUser = async (context: AiToolContext) => {
  if (context.role !== "STAFF") return undefined;
  const staff = await prisma.staff.findFirst({
    where: {
      userId: context.userId,
      ...(context.salonId ? { salonId: context.salonId } : {}),
      ...(context.branchId ? { branchId: context.branchId } : {}),
    },
    select: { id: true },
  });
  return staff?.id ?? "__unauthorized_staff__";
};

const readTool = (tool: Omit<AiTool, "riskLevel">): AiTool => ({
  ...tool,
  riskLevel: "READ",
});

const metric = (
  key: string,
  label: string,
  value: number | string,
  format?: "NUMBER" | "INR" | "PERCENT" | "TIME"
) => ({
  key,
  label,
  value,
  ...(format ? { format } : {}),
});

export const getDailyTodayAppointmentsTool: AiTool = readTool({
  name: "GetTodayAppointments",
  description: "Returns today's appointment counts and appointment list.",
  requiredPermissions: ["appointments:read"],
  allowedRoles: [
    "SUPER_ADMIN",
    "SALON_ADMIN",
    "BRANCH_MANAGER",
    "RECEPTIONIST",
    "STAFF",
  ],

  async run({ context }) {
    const { start, end, date, timezone } = await salonTodayRange(context);
    const staffId = await staffIdForUser(context);
    const appointments = await prisma.appointment.findMany({
      where: {
        ...aiExactBranchScope(context),
        ...(staffId ? { staffId } : {}),
        startTime: { gte: start, lt: end },
      },
      select: {
        id: true,
        appointmentCode: true,
        status: true,
        startTime: true,
        endTime: true,
        estimatedAmount: true,
        customer: { select: { name: true, customerCode: true } },
        staff: { select: { name: true } },
        services: { select: { serviceName: true } },
      },
      orderBy: { startTime: "asc" },
    });
    const byStatus = appointments.reduce<Record<string, number>>(
      (acc, appointment) => {
        acc[appointment.status] = (acc[appointment.status] ?? 0) + 1;
        return acc;
      },
      {}
    );
    const unconfirmed = appointments.filter(
      (appointment) => appointment.status === "SCHEDULED"
    ).length;
    const estimatedRevenue = appointments.reduce(
      (sum, appointment) => sum + Number(appointment.estimatedAmount ?? 0),
      0
    );
    return {
      summary: `${appointments.length} appointment${
        appointments.length === 1 ? "" : "s"
      } scheduled for ${date}.`,
      data: {
        date,
        timezone,
        total: appointments.length,
        unconfirmed,
        byStatus,
        estimatedRevenue,
        appointments: appointments.slice(0, 12).map((appointment) => ({
          appointmentCode: appointment.appointmentCode,
          status: appointment.status,
          startTime: appointment.startTime.toISOString(),
          endTime: appointment.endTime.toISOString(),
          customerName: appointment.customer.name,
          customerCode: appointment.customer.customerCode,
          staffName: appointment.staff?.name ?? null,
          services: appointment.services.map((service) => service.serviceName),
        })),
      },
      dailyBrief: {
        metrics: [
          metric("appointments_today", "Appointments", appointments.length, "NUMBER"),
          metric("unconfirmed_appointments", "Unconfirmed", unconfirmed, "NUMBER"),
          metric("estimated_revenue", "Expected revenue", estimatedRevenue, "INR"),
        ],
        alerts:
          unconfirmed > 0
            ? [
                {
                  severity: "WARNING",
                  code: "UNCONFIRMED_APPOINTMENTS",
                  message: `${unconfirmed} appointment${
                    unconfirmed === 1 ? " is" : "s are"
                  } still unconfirmed.`,
                  evidence: { count: unconfirmed },
                },
              ]
            : [],
      },
    };
  },
});

export const getExpectedRevenueTool: AiTool = readTool({
  name: "GetExpectedRevenue",
  description: "Returns today's expected appointment revenue and collected payments.",
  requiredPermissions: ["billing:read"],
  allowedRoles: ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER"],

  async run({ context }) {
    const { start, end } = await salonTodayRange(context);
    const appointmentWhere = {
      ...aiExactBranchScope(context),
      startTime: { gte: start, lt: end },
      status: {
        notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW],
      },
    };
    const paymentWhere = {
      ...aiExactBranchScope(context),
      paidAt: { gte: start, lt: end },
    };
    const [appointmentAggregate, paymentAggregate] = await Promise.all([
      prisma.appointment.aggregate({
        where: appointmentWhere,
        _sum: { estimatedAmount: true },
      }),
      prisma.payment.aggregate({
        where: paymentWhere,
        _sum: { amount: true },
      }),
    ]);
    const expected = Number(appointmentAggregate._sum?.estimatedAmount ?? 0);
    const collected = Number(paymentAggregate._sum.amount ?? 0);
    return {
      summary: `Expected revenue is ${inr.format(
        expected
      )}; collected so far is ${inr.format(collected)}.`,
      data: { expectedRevenue: expected, collectedRevenue: collected },
      dailyBrief: {
        metrics: [
          metric("expected_revenue", "Expected revenue", expected, "INR"),
          metric("collected_revenue", "Collected", collected, "INR"),
        ],
      },
    };
  },
});

export const getUnpaidInvoicesTool: AiTool = readTool({
  name: "GetUnpaidInvoices",
  description: "Returns unpaid and partially paid invoice totals.",
  requiredPermissions: ["billing:read"],
  allowedRoles: ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST"],

  async run({ context }) {
    const where = {
      ...aiExactBranchScope(context),
      status: "ISSUED" as const,
      balanceAmount: { gt: 0 },
    };
    const [total, aggregate, invoices] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.aggregate({ where, _sum: { balanceAmount: true } }),
      prisma.invoice.findMany({
        where,
        select: {
          invoiceCode: true,
          customerName: true,
          balanceAmount: true,
          paymentStatus: true,
          invoiceDate: true,
        },
        orderBy: { balanceAmount: "desc" },
        take: 5,
      }),
    ]);
    const balance = Number(aggregate._sum.balanceAmount ?? 0);
    return {
      summary: `${total} invoice${total === 1 ? " has" : "s have"} ${inr.format(
        balance
      )} unpaid.`,
      data: {
        total,
        balance,
        invoices: invoices.map((invoice) => ({
          ...invoice,
          balanceAmount: Number(invoice.balanceAmount),
          invoiceDate: invoice.invoiceDate.toISOString(),
        })),
      },
      dailyBrief: {
        metrics: [metric("unpaid_invoices", "Unpaid invoices", total, "NUMBER")],
        alerts:
          balance > 0
            ? [
                {
                  severity: total > 5 ? "CRITICAL" : "WARNING",
                  code: "UNPAID_INVOICES",
                  message: `${inr.format(balance)} is pending across ${total} invoice${
                    total === 1 ? "" : "s"
                  }.`,
                  evidence: { count: total, balance },
                },
              ]
            : [],
      },
    };
  },
});

export const getStaffUtilizationTool: AiTool = readTool({
  name: "GetStaffUtilization",
  description: "Returns today's active staff and booked time utilization.",
  requiredPermissions: ["staff:read"],
  allowedRoles: ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER"],

  async run({ context }) {
    const { start, end } = await salonTodayRange(context);
    const staffWhere = { ...aiExactBranchScope(context), status: true };
    const [staff, appointments] = await Promise.all([
      prisma.staff.findMany({
        where: staffWhere,
        select: { id: true, name: true, workingFrom: true, workingTo: true },
      }),
      prisma.appointment.findMany({
        where: {
          ...aiExactBranchScope(context),
          startTime: { gte: start, lt: end },
          status: {
            notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW],
          },
        },
        select: { staffId: true, totalDurationMinutes: true, startTime: true, endTime: true },
      }),
    ]);
    const bookedMinutes = appointments.reduce((sum, appointment) => {
      const duration =
        appointment.totalDurationMinutes ||
        Math.max(0, (appointment.endTime.getTime() - appointment.startTime.getTime()) / 60_000);
      return sum + duration;
    }, 0);
    const capacityMinutes = staff.length * 8 * 60;
    const utilization =
      capacityMinutes > 0 ? Math.round((bookedMinutes / capacityMinutes) * 100) : 0;
    return {
      summary: `${staff.length} active staff with roughly ${utilization}% booked utilization today.`,
      data: { activeStaff: staff.length, bookedMinutes, capacityMinutes, utilization },
      dailyBrief: {
        metrics: [
          metric("active_staff", "Active staff", staff.length, "NUMBER"),
          metric("staff_utilization", "Staff utilization", utilization, "PERCENT"),
        ],
        alerts:
          utilization >= 85
            ? [
                {
                  severity: "WARNING",
                  code: "HIGH_STAFF_UTILIZATION",
                  message: "Staff schedule is heavily booked today.",
                  evidence: { utilization },
                },
              ]
            : [],
      },
    };
  },
});

export const getStaffAbsencesTool: AiTool = readTool({
  name: "GetStaffAbsences",
  description: "Returns approved staff absences for today.",
  requiredPermissions: ["staff:read"],
  allowedRoles: ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER"],

  async run({ context }) {
    const { start, date } = await salonTodayRange(context);
    const leaves = await prisma.staffLeave.findMany({
      where: {
        ...aiExactBranchScope(context),
        status: "APPROVED",
        startDate: { lte: start },
        endDate: { gte: start },
      },
      select: {
        leaveType: true,
        reason: true,
        staff: { select: { name: true, jobRole: true } },
      },
      orderBy: { staff: { name: "asc" } },
    });
    return {
      summary:
        leaves.length === 0
          ? `No approved staff absences are recorded for ${date}.`
          : `${leaves.length} staff absence${leaves.length === 1 ? "" : "s"} today.`,
      data: {
        date,
        total: leaves.length,
        absences: leaves.map((leave) => ({
          staffName: leave.staff.name,
          jobRole: leave.staff.jobRole,
          leaveType: leave.leaveType,
          reason: leave.reason,
        })),
      },
      dailyBrief: {
        metrics: [metric("staff_absences", "Staff absences", leaves.length, "NUMBER")],
        alerts:
          leaves.length > 0
            ? [
                {
                  severity: "INFO",
                  code: "STAFF_ABSENCES",
                  message: `${leaves.length} staff member${
                    leaves.length === 1 ? " is" : "s are"
                  } on approved leave today.`,
                  evidence: { count: leaves.length },
                },
              ]
            : [],
      },
    };
  },
});

export const getLowStockTool: AiTool = readTool({
  name: "GetLowStock",
  description: "Returns low-stock products.",
  requiredPermissions: ["inventory:read"],
  allowedRoles: ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER"],

  async run({ context }) {
    const products = await prisma.product.findMany({
      where: {
        ...aiSharedBranchScope(context),
        status: true,
        lowStockAlert: { gt: 0 },
      },
      select: { name: true, currentStock: true, lowStockAlert: true, unit: true },
      orderBy: { name: "asc" },
      take: 50,
    });
    const lowStock = products
      .filter((product) => Number(product.currentStock) <= Number(product.lowStockAlert))
      .map((product) => ({
        name: product.name,
        currentStock: Number(product.currentStock),
        lowStockAlert: Number(product.lowStockAlert),
        unit: product.unit,
      }));
    return {
      summary: `${lowStock.length} product${
        lowStock.length === 1 ? " is" : "s are"
      } low on stock.`,
      data: { total: lowStock.length, products: lowStock.slice(0, 10) },
      dailyBrief: {
        metrics: [metric("low_stock_products", "Low stock", lowStock.length, "NUMBER")],
        alerts:
          lowStock.length > 0
            ? [
                {
                  severity: "WARNING",
                  code: "LOW_STOCK",
                  message: `${lowStock.length} product${
                    lowStock.length === 1 ? " needs" : "s need"
                  } reorder attention.`,
                  evidence: { products: lowStock.slice(0, 3) },
                },
              ]
            : [],
      },
    };
  },
});

export const getCustomerBirthdaysTool: AiTool = readTool({
  name: "GetCustomerBirthdays",
  description: "Returns customers whose birthday is today.",
  requiredPermissions: ["customers:read"],
  allowedRoles: ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST"],

  async run({ context }) {
    const { date, timezone } = await salonTodayRange(context);
    const [, month, day] = date.split("-");
    const customers = await prisma.customer.findMany({
      where: {
        ...aiExactBranchScope(context),
        dob: { not: null },
      },
      select: { customerCode: true, name: true, dob: true },
      orderBy: { name: "asc" },
      take: 500,
    });
    const birthdays = customers.filter((customer) => {
      if (!customer.dob) return false;
      const local = localDate(customer.dob, timezone);
      return local.slice(5) === `${month}-${day}`;
    });
    return {
      summary: `${birthdays.length} customer birthday${
        birthdays.length === 1 ? "" : "s"
      } today.`,
      data: {
        date,
        total: birthdays.length,
        customers: birthdays.slice(0, 10).map((customer) => ({
          customerCode: customer.customerCode,
          name: customer.name,
        })),
      },
      dailyBrief: {
        metrics: [
          metric("customer_birthdays", "Customer birthdays", birthdays.length, "NUMBER"),
        ],
        alerts:
          birthdays.length > 0
            ? [
                {
                  severity: "INFO",
                  code: "CUSTOMER_BIRTHDAYS",
                  message: `${birthdays.length} customer birthday${
                    birthdays.length === 1 ? "" : "s"
                  } today.`,
                  evidence: { count: birthdays.length },
                },
              ]
            : [],
      },
    };
  },
});

export const getOperationalAlertsTool: AiTool = readTool({
  name: "GetOperationalAlerts",
  description: "Returns open operational support alerts.",
  requiredPermissions: ["support:read"],
  allowedRoles: ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER"],

  async run({ context }) {
    const openTickets = await prisma.supportTicket.findMany({
      where: {
        ...aiSharedBranchScope(context),
        status: { in: ["OPEN", "IN_PROGRESS"] as const },
      },
      select: { ticketCode: true, title: true, priority: true, status: true },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      take: 5,
    });
    return {
      summary: `${openTickets.length} open operational support alert${
        openTickets.length === 1 ? "" : "s"
      }.`,
      data: { total: openTickets.length, tickets: openTickets },
      dailyBrief: {
        metrics: [
          metric("operational_alerts", "Operational alerts", openTickets.length, "NUMBER"),
        ],
        alerts: openTickets.map((ticket) => ({
          severity: ticket.priority === "URGENT" ? "CRITICAL" : "WARNING",
          code: "OPEN_SUPPORT_TICKET",
          message: `${ticket.ticketCode}: ${ticket.title}`,
          evidence: { priority: ticket.priority, status: ticket.status },
        })),
      },
    };
  },
});

export const DAILY_BRIEF_TOOL_NAMES = [
  "GetTodayAppointments",
  "GetExpectedRevenue",
  "GetUnpaidInvoices",
  "GetStaffUtilization",
  "GetStaffAbsences",
  "GetLowStock",
  "GetCustomerBirthdays",
  "GetOperationalAlerts",
] as const;

export function buildDailyBriefResponse(params: {
  date: string;
  sources: DailyBriefResponse["sources"];
  results: AiToolResult[];
}): DailyBriefResponse {
  const metrics = params.results.flatMap((result) => result.dailyBrief?.metrics ?? []);
  const alerts = params.results.flatMap((result) => result.dailyBrief?.alerts ?? []);
  const failed = params.sources.filter((source) => source.status === "FAILED");
  const successful = params.sources.filter((source) => source.status === "SUCCESS");
  const score =
    params.sources.length === 0
      ? 0
      : Math.round((successful.length / params.sources.length) * 100) / 100;
  const level = score >= 0.9 ? "HIGH" : score >= 0.5 ? "MEDIUM" : "LOW";
  const limitations = failed.map((source) => `${source.tool} data was unavailable.`);
  const metricValue = (key: string) =>
    metrics.find((item) => item.key === key)?.value;
  const appointmentCount = metricValue("appointments_today") ?? "unknown";
  const expectedRevenue = metricValue("expected_revenue") ?? metricValue("estimated_revenue");
  const expectedText =
    typeof expectedRevenue === "number" ? inr.format(expectedRevenue) : "unavailable";
  const alertText =
    alerts.length === 0
      ? "No major alerts came back from the available sources."
      : `${alerts.length} alert${alerts.length === 1 ? "" : "s"} need attention.`;
  const answer = `Today (${params.date}) shows ${appointmentCount} appointment${
    appointmentCount === 1 ? "" : "s"
  }, expected revenue of ${expectedText}, and ${alertText}`;

  return {
    type: "DAILY_BRIEF",
    answer,
    confidence: {
      level,
      score,
      ...(limitations.length ? { limitations } : {}),
    },
    metrics,
    alerts,
    actions: [
      {
        type: "OPEN_APPOINTMENTS",
        label: "Review today's appointments",
        requiresConfirmation: false,
        enabled: true,
      },
      {
        type: "OPEN_LOW_STOCK",
        label: "Review low-stock products",
        requiresConfirmation: false,
        enabled: alerts.some((alert) => alert.code === "LOW_STOCK"),
      },
      {
        type: "OPEN_UNPAID_INVOICES",
        label: "Review unpaid invoices",
        requiresConfirmation: false,
        enabled: alerts.some((alert) => alert.code === "UNPAID_INVOICES"),
      },
    ],
    sources: params.sources,
  };
}
