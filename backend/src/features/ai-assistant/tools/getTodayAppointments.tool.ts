import { prisma } from "../../../config/prisma.js";
import { parseSalonDateRange } from "../../../utils/timezone.js";
import type {
  AiTool,
  AiToolContext,
} from "../ai-tool.types.js";
import { aiExactBranchScope } from "../ai-permission.service.js";

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

const todayRange = async (
  context: AiToolContext
): Promise<{ start: Date; end: Date }> => {
  const salon = context.salonId
    ? await prisma.salon.findUnique({
        where: { id: context.salonId },
        select: { timezone: true },
      })
    : null;
  const timezone = salon?.timezone ?? "Asia/Kolkata";
  const today = localDate(new Date(), timezone);
  const range = parseSalonDateRange(today, today, timezone);
  const { start, end } = range;
  if (!start || !end) {
    throw new Error("Unable to determine the salon day");
  }
  return { start, end };
};

export const getTodayAppointmentsTool: AiTool = {
  name: "getTodayAppointments",
  description: "Returns today's appointment summary.",
  allowedRoles: [
    "SUPER_ADMIN",
    "SALON_ADMIN",
    "BRANCH_MANAGER",
    "RECEPTIONIST",
  ],

  async run({ context }) {
    const { start, end } = await todayRange(context);
    const appointments = await prisma.appointment.findMany({
      where: {
        ...(context.salonId ? { salonId: context.salonId } : {}),
        ...aiExactBranchScope(context),
        startTime: { gte: start, lt: end },
      },
      select: {
        id: true,
        appointmentCode: true,
        status: true,
        startTime: true,
        customer: { select: { id: true, name: true, customerCode: true } },
        staff: { select: { name: true } },
      },
      orderBy: { startTime: "asc" },
    });

    const byStatus = appointments.reduce<Record<string, number>>(
      (counts, appointment) => {
        counts[appointment.status] = (counts[appointment.status] ?? 0) + 1;
        return counts;
      },
      {}
    );

    const unconfirmed = appointments.filter(
      (appointment) => appointment.status === "SCHEDULED"
    );

    return {
      summary: `You have ${appointments.length} appointment${
        appointments.length === 1 ? "" : "s"
      } today.`,
      data: {
        total: appointments.length,
        byStatus,
        appointments: appointments.slice(0, 10).map((appointment) => ({
          id: appointment.id,
          appointmentCode: appointment.appointmentCode,
          status: appointment.status,
          startTime: appointment.startTime.toISOString(),
          customerName: appointment.customer.name,
          customerCode: appointment.customer.customerCode,
          staffName: appointment.staff?.name ?? null,
        })),
        unconfirmedCustomerIds: unconfirmed
          .map((appointment) => appointment.customer.id)
          .slice(0, 25),
      },
      cards: [
        { type: "METRIC", title: "Appointments", value: String(appointments.length) },
        {
          type: unconfirmed.length ? "WARNING" : "METRIC",
          title: "Unconfirmed",
          value: String(unconfirmed.length),
          description:
            unconfirmed.length > 0
              ? "Confirm or remind these customers first."
              : "No unconfirmed appointments found.",
        },
      ],
      table: {
        columns: [
          { key: "time", label: "Time" },
          { key: "customer", label: "Customer" },
          { key: "status", label: "Status" },
        ],
        rows: appointments.slice(0, 10).map((appointment) => ({
          time: appointment.startTime.toISOString(),
          customer: appointment.customer.name,
          staff: appointment.staff?.name ?? "",
          status: appointment.status,
          appointmentId: appointment.id,
        })),
      },
      suggestedActions:
        unconfirmed.length > 0
          ? [
              {
                id: "prepare-reminders",
                label: "Prepare reminders",
                actionType: "PREVIEW_MESSAGE",
                requiresConfirmation: false,
                payload: {
                  customerIds: unconfirmed
                    .map((appointment) => appointment.customer.id)
                    .slice(0, 25),
                },
              },
            ]
          : undefined,
      warnings:
        unconfirmed.length > 0
          ? [`${unconfirmed.length} appointment${unconfirmed.length === 1 ? "" : "s"} still need confirmation.`]
          : undefined,
    };
  },
};
