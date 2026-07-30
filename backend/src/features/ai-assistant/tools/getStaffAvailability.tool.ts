import { prisma } from "../../../config/prisma.js";
import {
  parseSalonDateRange,
  salonLocalDateTimeToUtc,
} from "../../../utils/timezone.js";
import { checkStaffAvailabilityForSlot } from "../../staff-availability/staffAvailability.service.js";
import type { AiTool, AiToolContext } from "../ai-tool.types.js";
import { aiExactBranchScope } from "../ai-permission.service.js";

const DEFAULT_SLOT_MINUTES = 30;

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

const parseRequestedTime = (message: string) => {
  const meridiemMatch = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(message);
  if (meridiemMatch) {
    const [, hourValue, minuteValue, meridiemValue] = meridiemMatch;
    if (!hourValue || !meridiemValue) return null;
    let hour = Number(hourValue);
    const minute = Number(minuteValue ?? 0);
    const meridiem = meridiemValue.toLowerCase();
    if (hour < 1 || hour > 12 || minute > 59) return null;
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  const twentyFourHourMatch = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(message);
  if (twentyFourHourMatch) {
    const [, hourValue, minuteValue] = twentyFourHourMatch;
    if (!hourValue || !minuteValue) return null;
    return `${String(Number(hourValue)).padStart(2, "0")}:${minuteValue}`;
  }

  return null;
};

const salonDay = async (
  context: AiToolContext
): Promise<{ date: string; timezone: string }> => {
  const salon = context.salonId
    ? await prisma.salon.findUnique({
        where: { id: context.salonId },
        select: { timezone: true },
      })
    : null;
  const timezone = salon?.timezone ?? "Asia/Kolkata";
  return { date: localDate(new Date(), timezone), timezone };
};

export const getStaffAvailabilityTool: AiTool = {
  name: "getStaffAvailability",
  description: "Returns staff available for a requested time today.",
  allowedRoles: ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST"],

  async run({ message, context }) {
    const requestedTime = parseRequestedTime(message);
    if (!requestedTime) {
      return {
        summary: "Please include a time, for example: who is free at 4 PM?",
        data: { needsTime: true },
      };
    }

    const { date, timezone } = await salonDay(context);
    const range = parseSalonDateRange(date, date, timezone);
    if (!range.start || !range.end) {
      throw new Error("Unable to determine the salon day");
    }

    const startTime = salonLocalDateTimeToUtc(date, requestedTime, timezone);
    const endTime = new Date(
      startTime.getTime() + DEFAULT_SLOT_MINUTES * 60_000
    );
    const staff = await prisma.staff.findMany({
      where: {
        ...aiExactBranchScope(context),
        status: true,
      },
      select: {
        id: true,
        name: true,
        jobRole: true,
        branchId: true,
      },
      orderBy: { name: "asc" },
    });

    const checks = await Promise.all(
      staff.map(async (member) => ({
        member,
        check: await checkStaffAvailabilityForSlot({
          staffId: member.id,
          startTime,
          endTime,
          ...(context.salonId ? { salonId: context.salonId } : {}),
          ...(context.branchId ? { branchId: context.branchId } : {}),
        }),
      }))
    );
    const available = checks.filter((item) => item.check.available);

    return {
      summary:
        available.length === 0
          ? `No staff members are available at ${requestedTime} today.`
          : `${available.length} staff member${
              available.length === 1 ? " is" : "s are"
            } available at ${requestedTime} today.`,
      data: {
        date,
        time: requestedTime,
        durationMinutes: DEFAULT_SLOT_MINUTES,
        availableStaff: available.map(({ member }) => ({
          staffName: member.name,
          jobRole: member.jobRole,
          branchId: member.branchId,
        })),
        unavailableStaff: checks
          .filter((item) => !item.check.available)
          .map(({ member, check }) => ({
            staffName: member.name,
            jobRole: member.jobRole,
            reason: check.reason,
          })),
      },
    };
  },
};
