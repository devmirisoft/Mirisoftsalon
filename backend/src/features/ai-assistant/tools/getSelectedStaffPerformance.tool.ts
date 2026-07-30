import { prisma } from "../../../config/prisma.js";
import { parseSalonDateRange } from "../../../utils/timezone.js";
import type { AiTool } from "../ai-tool.types.js";
import { aiExactBranchScope } from "../ai-permission.service.js";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

const monthRange = async (salonId?: string) => {
  const salon = salonId
    ? await prisma.salon.findUnique({
        where: { id: salonId },
        select: { timezone: true },
      })
    : null;
  const timezone = salon?.timezone ?? "Asia/Kolkata";
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  const year = Number(part("year"));
  const month = Number(part("month"));
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;
  const range = parseSalonDateRange(from, to, timezone);
  if (!range.start || !range.end) {
    throw new Error("Unable to determine the salon month");
  }
  return { start: range.start, end: range.end };
};

export const getSelectedStaffPerformanceTool: AiTool = {
  name: "getSelectedStaffPerformance",
  description: "Returns appointment and sales performance for the selected staff member this month.",
  allowedRoles: ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "STAFF"],

  async run({ context, uiContext }) {
    const selected = uiContext?.selectedEntity;
    if (selected?.type !== "STAFF") {
      return {
        summary: "Open a staff profile first, then ask about this staff member.",
        warnings: ["No selected staff member was provided by the current screen."],
      };
    }

    const staffWhere =
      context.role === "STAFF"
        ? {
            id: selected.id,
            userId: context.userId,
            ...aiExactBranchScope(context),
          }
        : {
            id: selected.id,
            ...aiExactBranchScope(context),
          };

    const staff = await prisma.staff.findFirst({
      where: staffWhere,
      select: {
        id: true,
        staffCode: true,
        name: true,
        jobRole: true,
        branchId: true,
      },
    });

    if (!staff) {
      return {
        summary: "I could not find that staff member within your allowed access.",
        warnings: ["The selected staff member is unavailable or outside your access."],
      };
    }

    const { start, end } = await monthRange(context.salonId);
    const appointmentWhere = {
      ...(context.salonId ? { salonId: context.salonId } : {}),
      ...aiExactBranchScope(context),
      staffId: staff.id,
      startTime: { gte: start, lt: end },
    };
    const saleWhere = {
      ...(context.salonId ? { salonId: context.salonId } : {}),
      ...aiExactBranchScope(context),
      staffId: staff.id,
      saleDate: { gte: start, lt: end },
      status: "ACTIVE" as const,
    };

    const [appointments, salesAggregate, saleCount] = await Promise.all([
      prisma.appointment.findMany({
        where: appointmentWhere,
        select: { status: true },
      }),
      prisma.sale.aggregate({
        where: saleWhere,
        _sum: { totalAmount: true },
      }),
      prisma.sale.count({ where: saleWhere }),
    ]);

    const byStatus = appointments.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {});
    const totalAppointments = appointments.length;
    const completed = byStatus.COMPLETED ?? 0;
    const salesTotal = Number(salesAggregate._sum.totalAmount ?? 0);

    return {
      summary: `${staff.name} has ${totalAppointments} appointment${
        totalAppointments === 1 ? "" : "s"
      } this month, ${completed} completed, and ${inr.format(
        salesTotal
      )} in recorded sales.`,
      data: {
        staff,
        period: { from: start.toISOString(), to: end.toISOString() },
        appointments: { total: totalAppointments, byStatus },
        sales: {
          totalAmount: salesTotal,
          saleCount,
          currency: "INR",
        },
      },
      cards: [
        {
          type: "ENTITY",
          title: staff.name,
          value: staff.staffCode ?? staff.jobRole,
          entityType: "STAFF",
          entityId: staff.id,
        },
        {
          type: "METRIC",
          title: "Completed appointments",
          value: String(completed),
        },
        {
          type: "METRIC",
          title: "Sales",
          value: inr.format(salesTotal),
        },
      ],
      suggestedActions: [
        {
          id: "open-staff-performance",
          label: "Open staff performance",
          actionType: "NAVIGATE",
          requiresConfirmation: false,
          payload: { route: "/reports/staff-performance" },
        },
      ],
    };
  },
};
