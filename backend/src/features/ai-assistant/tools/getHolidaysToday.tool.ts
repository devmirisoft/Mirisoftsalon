import { prisma } from "../../../config/prisma.js";
import { parseSalonDateRange } from "../../../utils/timezone.js";
import type { AiTool, AiToolContext } from "../ai-tool.types.js";
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

const today = async (
  context: AiToolContext
): Promise<{ date: string; start: Date; end: Date }> => {
  const salon = context.salonId
    ? await prisma.salon.findUnique({
        where: { id: context.salonId },
        select: { timezone: true },
      })
    : null;
  const timezone = salon?.timezone ?? "Asia/Kolkata";
  const date = localDate(new Date(), timezone);
  const range = parseSalonDateRange(date, date, timezone);
  if (!range.start || !range.end) {
    throw new Error("Unable to determine the salon day");
  }
  return { date, start: range.start, end: range.end };
};

export const getHolidaysTodayTool: AiTool = {
  name: "getHolidaysToday",
  description: "Returns staff members with approved leave today.",
  allowedRoles: ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER"],

  async run({ context }) {
    const { date, start } = await today(context);
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
        startDate: true,
        endDate: true,
        totalDays: true,
        branchId: true,
        staff: {
          select: {
            name: true,
            jobRole: true,
          },
        },
      },
      orderBy: [{ startDate: "asc" }, { staff: { name: "asc" } }],
    });

    return {
      summary:
        leaves.length === 0
          ? `No approved staff holidays are recorded for ${date}.`
          : `${leaves.length} staff member${
              leaves.length === 1 ? " is" : "s are"
            } on approved leave today.`,
      data: {
        date,
        total: leaves.length,
        holidaysToday: leaves.map((leave) => ({
          staffName: leave.staff.name,
          jobRole: leave.staff.jobRole,
          leaveType: leave.leaveType,
          reason: leave.reason,
          startDate: leave.startDate.toISOString().slice(0, 10),
          endDate: leave.endDate.toISOString().slice(0, 10),
          totalDays: leave.totalDays,
          branchId: leave.branchId,
        })),
      },
    };
  },
};
