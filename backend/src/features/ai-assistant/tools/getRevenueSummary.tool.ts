import { prisma } from "../../../config/prisma.js";
import { parseSalonDateRange } from "../../../utils/timezone.js";
import type {
  AiTool,
  AiToolContext,
} from "../ai-tool.types.js";
import { aiExactBranchScope } from "../ai-permission.service.js";

const getTodayRange = async (
  context: AiToolContext
): Promise<{ start: Date; end: Date }> => {
  const salon = context.salonId
    ? await prisma.salon.findUnique({
        where: { id: context.salonId },
        select: { timezone: true },
      })
    : null;
  const timezone = salon?.timezone ?? "Asia/Kolkata";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const range = parseSalonDateRange(today, today, timezone);
  const { start, end } = range;
  if (!start || !end) {
    throw new Error("Unable to determine the salon day");
  }
  return { start, end };
};

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

export const getRevenueSummaryTool: AiTool = {
  name: "getRevenueSummary",
  description: "Returns today's collected revenue summary.",
  allowedRoles: ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER"],

  async run({ context }) {
    const { start, end } = await getTodayRange(context);
    const where = {
      ...(context.salonId ? { salonId: context.salonId } : {}),
      ...aiExactBranchScope(context),
      paidAt: { gte: start, lt: end },
    };
    const [aggregate, paymentCount] = await Promise.all([
      prisma.payment.aggregate({
        where,
        _sum: { amount: true },
      }),
      prisma.payment.count({ where }),
    ]);
    const total = Number(aggregate._sum?.amount ?? 0);

    return {
      summary: `Today's collected revenue is ${inr.format(
        total
      )} from ${paymentCount} payment${paymentCount === 1 ? "" : "s"}.`,
      data: {
        totalRevenue: total,
        paymentCount,
        currency: "INR",
      },
      cards: [
        {
          type: "METRIC",
          title: "Revenue",
          value: inr.format(total),
          description: `${paymentCount} payment${paymentCount === 1 ? "" : "s"} today`,
        },
      ],
    };
  },
};
