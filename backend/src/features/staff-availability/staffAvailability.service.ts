import { prisma } from "../../config/prisma.js";
import {
  Prisma,
  type StaffAvailabilityStatus,
  type StaffTimeBlockType,
} from "../../generated/prisma/client.js";
import {
  getSalonLocalParts,
  parseSalonDateRange,
  salonLocalDateTimeToUtc,
} from "../../utils/timezone.js";
import { createAuditLog } from "../audit-logs/audit-log.service.js";

type DbClient = typeof prisma | Prisma.TransactionClient;
type AuditContext = { ipAddress?: string; userAgent?: string };

export type StaffAvailabilityActor = {
  userId: string;
  role: string;
  salonId?: string;
  branchId?: string;
};

export class StaffAvailabilityError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "StaffAvailabilityError";
  }
}

type AvailabilityWindow = {
  startTimeMinutes: number;
  endTimeMinutes: number;
  source: "ROSTER" | "LEGACY";
  ruleId: string | null;
};

type AvailabilityStaff = {
  id: string;
  name: string;
  workingFrom: string;
  workingTo: string;
  weekOff: string;
};

const branchScopedRoles = new Set(["BRANCH_MANAGER", "RECEPTIONIST"]);
const mutationRoles = new Set([
  "SUPER_ADMIN",
  "SALON_ADMIN",
  "BRANCH_MANAGER",
]);

const ruleInclude = {
  staff: {
    select: {
      id: true,
      staffCode: true,
      name: true,
      jobRole: true,
      status: true,
    },
  },
  branch: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true, role: true } },
} as const;

const blockInclude = {
  staff: {
    select: {
      id: true,
      staffCode: true,
      name: true,
      jobRole: true,
      status: true,
    },
  },
  branch: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true, role: true } },
} as const;

export const parseDateOnly = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new StaffAvailabilityError(400, "Date must use YYYY-MM-DD");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new StaffAvailabilityError(400, "Invalid date");
  }
  return date;
};

const dateStringInTimezone = (date: Date, timezone: string) => {
  const local = getSalonLocalParts(date, timezone);
  return `${local.year}-${String(local.month).padStart(2, "0")}-${String(
    local.day
  ).padStart(2, "0")}`;
};

const minutesToTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
    minutes % 60
  ).padStart(2, "0")}`;

const timeToMinutes = (value: string) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const periodsOverlap = (
  leftFrom: Date | null,
  leftUntil: Date | null,
  rightFrom: Date | null,
  rightUntil: Date | null
) => {
  const leftStart = leftFrom?.getTime() ?? Number.NEGATIVE_INFINITY;
  const leftEnd = leftUntil?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightStart = rightFrom?.getTime() ?? Number.NEGATIVE_INFINITY;
  const rightEnd = rightUntil?.getTime() ?? Number.POSITIVE_INFINITY;
  return leftStart <= rightEnd && rightStart <= leftEnd;
};

const requireMutationRole = (actor: StaffAvailabilityActor) => {
  if (!mutationRoles.has(actor.role)) {
    throw new StaffAvailabilityError(
      403,
      "You do not have permission to manage the staff roster"
    );
  }
};

const ownStaffId = async (
  client: DbClient,
  actor: StaffAvailabilityActor
) => {
  const staff = await client.staff.findFirst({
    where: { userId: actor.userId },
    select: { id: true, salonId: true, branchId: true },
  });
  if (!staff) {
    throw new StaffAvailabilityError(
      404,
      "Staff profile not found for this user"
    );
  }
  return staff;
};

const scopeForActor = async (
  client: DbClient,
  actor: StaffAvailabilityActor
): Promise<{
  salonId?: string;
  branchId?: string;
  staffId?: string;
}> => {
  if (actor.role === "SUPER_ADMIN") return {};
  if (!actor.salonId) {
    throw new StaffAvailabilityError(403, "Salon access is required");
  }
  if (actor.role === "STAFF") {
    const staff = await ownStaffId(client, actor);
    return {
      salonId: actor.salonId,
      ...(staff.branchId ? { branchId: staff.branchId } : {}),
      staffId: staff.id,
    };
  }
  return {
    salonId: actor.salonId,
    ...(branchScopedRoles.has(actor.role)
      ? { branchId: actor.branchId ?? "__unauthorized__" }
      : {}),
  };
};

const assertRequestedScope = (
  scope: { salonId?: string; branchId?: string; staffId?: string },
  input: { salonId: string; branchId: string; staffId: string }
) => {
  if (
    (scope.salonId && scope.salonId !== input.salonId) ||
    (scope.branchId && scope.branchId !== input.branchId) ||
    (scope.staffId && scope.staffId !== input.staffId)
  ) {
    throw new StaffAvailabilityError(404, "Staff roster entry not found");
  }
};

const requireStaffTarget = async (
  client: DbClient,
  actor: StaffAvailabilityActor,
  staffId: string,
  branchId: string
) => {
  const scope = await scopeForActor(client, actor);
  const staff = await client.staff.findUnique({
    where: { id: staffId },
    include: {
      salon: { select: { id: true, timezone: true } },
      branch: { select: { id: true, salonId: true } },
    },
  });
  if (!staff) {
    throw new StaffAvailabilityError(404, "Staff member not found");
  }
  if (!staff.branchId || staff.branchId !== branchId) {
    throw new StaffAvailabilityError(
      400,
      "branchId must match the staff branch"
    );
  }
  assertRequestedScope(scope, {
    salonId: staff.salonId,
    branchId,
    staffId,
  });
  return staff;
};

const validateRuleValues = (input: {
  dayOfWeek: number;
  startTimeMinutes: number;
  endTimeMinutes: number;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
}) => {
  if (
    !Number.isInteger(input.dayOfWeek) ||
    input.dayOfWeek < 0 ||
    input.dayOfWeek > 6
  ) {
    throw new StaffAvailabilityError(
      400,
      "dayOfWeek must be between 0 and 6"
    );
  }
  if (
    !Number.isInteger(input.startTimeMinutes) ||
    !Number.isInteger(input.endTimeMinutes) ||
    input.startTimeMinutes < 0 ||
    input.endTimeMinutes > 1440 ||
    input.startTimeMinutes >= input.endTimeMinutes
  ) {
    throw new StaffAvailabilityError(
      400,
      "Availability start must be before end"
    );
  }
  if (
    input.effectiveFrom &&
    input.effectiveUntil &&
    input.effectiveFrom > input.effectiveUntil
  ) {
    throw new StaffAvailabilityError(
      400,
      "effectiveFrom cannot be later than effectiveUntil"
    );
  }
};

const assertNoRuleOverlap = async (
  client: DbClient,
  input: {
    staffId: string;
    dayOfWeek: number;
    startTimeMinutes: number;
    endTimeMinutes: number;
    effectiveFrom: Date | null;
    effectiveUntil: Date | null;
    status: StaffAvailabilityStatus;
    excludeId?: string;
  }
) => {
  if (input.status !== "ACTIVE") return;
  const candidates = await client.staffAvailabilityRule.findMany({
    where: {
      staffId: input.staffId,
      dayOfWeek: input.dayOfWeek,
      status: "ACTIVE",
      startTimeMinutes: { lt: input.endTimeMinutes },
      endTimeMinutes: { gt: input.startTimeMinutes },
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
    },
    select: {
      id: true,
      effectiveFrom: true,
      effectiveUntil: true,
    },
  });
  if (
    candidates.some((candidate) =>
      periodsOverlap(
        candidate.effectiveFrom,
        candidate.effectiveUntil,
        input.effectiveFrom,
        input.effectiveUntil
      )
    )
  ) {
    throw new StaffAvailabilityError(
      409,
      "Availability overlaps an existing active rule"
    );
  }
};

const rulesForDate = async (
  client: DbClient,
  staffId: string,
  date: string
) => {
  const day = parseDateOnly(date);
  return client.staffAvailabilityRule.findMany({
    where: {
      staffId,
      dayOfWeek: day.getUTCDay(),
      status: "ACTIVE",
      AND: [
        {
          OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: day } }],
        },
        {
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: day } }],
        },
      ],
    },
    orderBy: { startTimeMinutes: "asc" },
  });
};

const fallbackWindows = (
  staff: AvailabilityStaff,
  date: string
): AvailabilityWindow[] => {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
  })
    .format(parseDateOnly(date))
    .toUpperCase();
  const weekOffs = staff.weekOff
    .split(/[,/]/)
    .map((value) => value.trim().toUpperCase());
  if (weekOffs.includes(weekday)) return [];
  const startTimeMinutes = timeToMinutes(staff.workingFrom);
  const endTimeMinutes = timeToMinutes(staff.workingTo);
  return startTimeMinutes !== null &&
    endTimeMinutes !== null &&
    startTimeMinutes < endTimeMinutes
    ? [
        {
          startTimeMinutes,
          endTimeMinutes,
          source: "LEGACY",
          ruleId: null,
        },
      ]
    : [];
};

const availabilityWindows = async (
  client: DbClient,
  staff: AvailabilityStaff,
  date: string
): Promise<AvailabilityWindow[]> => {
  const rules = await rulesForDate(client, staff.id, date);
  if (rules.length) {
    return rules.map((rule) => ({
      startTimeMinutes: rule.startTimeMinutes,
      endTimeMinutes: rule.endTimeMinutes,
      source: "ROSTER",
      ruleId: rule.id,
    }));
  }
  return fallbackWindows(staff, date);
};

export type StaffAvailabilityCheck = {
  available: boolean;
  reason:
    | "AVAILABLE"
    | "STAFF_NOT_FOUND"
    | "STAFF_INACTIVE"
    | "WRONG_SALON"
    | "WRONG_BRANCH"
    | "OUTSIDE_AVAILABILITY"
    | "APPROVED_LEAVE"
    | "TIME_BLOCK"
    | "APPOINTMENT_CONFLICT";
  message: string;
};

export const checkStaffAvailabilityForSlot = async (input: {
  staffId: string;
  startTime: Date;
  endTime: Date;
  salonId?: string;
  branchId?: string;
  excludeAppointmentId?: string;
  client?: DbClient;
  // Job carts are walk-ins: a service may legitimately run past the shift and
  // is banked as overtime (see syncStaffOvertime) instead of being rejected.
  allowOutsideAvailability?: boolean;
}): Promise<StaffAvailabilityCheck> => {
  const client = input.client ?? prisma;
  if (
    Number.isNaN(input.startTime.getTime()) ||
    Number.isNaN(input.endTime.getTime()) ||
    input.startTime >= input.endTime
  ) {
    return {
      available: false,
      reason: "OUTSIDE_AVAILABILITY",
      message: "Appointment start must be before end",
    };
  }
  const staff = await client.staff.findUnique({
    where: { id: input.staffId },
    include: { salon: { select: { timezone: true } } },
  });
  if (!staff) {
    return {
      available: false,
      reason: "STAFF_NOT_FOUND",
      message: "Staff member not found",
    };
  }
  if (!staff.status) {
    return {
      available: false,
      reason: "STAFF_INACTIVE",
      message: "Inactive staff cannot be booked",
    };
  }
  if (input.salonId && staff.salonId !== input.salonId) {
    return {
      available: false,
      reason: "WRONG_SALON",
      message: "Staff does not belong to this salon",
    };
  }
  if (
    input.branchId &&
    staff.branchId !== null &&
    staff.branchId !== input.branchId
  ) {
    return {
      available: false,
      reason: "WRONG_BRANCH",
      message: "Staff does not belong to this branch",
    };
  }

  const timezone = staff.salon.timezone;
  const date = dateStringInTimezone(input.startTime, timezone);
  const startLocal = getSalonLocalParts(input.startTime, timezone);
  const endLocal = getSalonLocalParts(input.endTime, timezone);
  const startMinutes = startLocal.hour * 60 + startLocal.minute;
  const endMinutes = endLocal.hour * 60 + endLocal.minute;
  const sameDay =
    startLocal.year === endLocal.year &&
    startLocal.month === endLocal.month &&
    startLocal.day === endLocal.day;
  const windows = await availabilityWindows(client, staff, date);
  if (
    !input.allowOutsideAvailability &&
    (!sameDay ||
      !windows.some(
        (window) =>
          startMinutes >= window.startTimeMinutes &&
          endMinutes <= window.endTimeMinutes
      ))
  ) {
    return {
      available: false,
      reason: "OUTSIDE_AVAILABILITY",
      message: "Appointment is outside staff availability",
    };
  }

  const day = parseDateOnly(date);
  const [leave, block, conflict] = await Promise.all([
    client.staffLeave.findFirst({
      where: {
        staffId: staff.id,
        status: "APPROVED",
        startDate: { lte: day },
        endDate: { gte: day },
      },
      select: { id: true },
    }),
    client.staffTimeBlock.findFirst({
      where: {
        staffId: staff.id,
        startTime: { lt: input.endTime },
        endTime: { gt: input.startTime },
      },
      select: { id: true },
    }),
    client.appointment.findFirst({
      where: {
        staffId: staff.id,
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        startTime: { lt: input.endTime },
        endTime: { gt: input.startTime },
        ...(input.excludeAppointmentId
          ? { id: { not: input.excludeAppointmentId } }
          : {}),
      },
      select: { id: true },
    }),
  ]);
  if (leave) {
    return {
      available: false,
      reason: "APPROVED_LEAVE",
      message: "Staff is on approved leave",
    };
  }
  if (block) {
    return {
      available: false,
      reason: "TIME_BLOCK",
      message: "Staff has a blocked time during this slot",
    };
  }
  if (conflict) {
    return {
      available: false,
      reason: "APPOINTMENT_CONFLICT",
      message: "Staff is already booked for this time slot",
    };
  }
  return {
    available: true,
    reason: "AVAILABLE",
    message: "Staff is available",
  };
};

/**
 * Minutes worked past the end of the working day: the shift end, or the
 * check-out if the staff member already logged out before it. With no shift
 * rostered at all (week off) the whole stretch from clock-in counts.
 */
export const overtimeMinutesFor = (input: {
  shiftEnd: Date | null;
  checkInTime: Date | null;
  checkOutTime: Date | null;
  latestBookingEnd: Date | null;
  slotStart: Date;
  slotEnd: Date;
}) => {
  const shiftEnd =
    input.shiftEnd ?? input.checkInTime ?? input.slotStart;
  const boundary =
    input.checkOutTime && input.checkOutTime < shiftEnd
      ? input.checkOutTime
      : shiftEnd;
  const workEnd =
    input.latestBookingEnd && input.latestBookingEnd > input.slotEnd
      ? input.latestBookingEnd
      : input.slotEnd;
  return Math.max(
    0,
    Math.round((workEnd.getTime() - boundary.getTime()) / 60_000)
  );
};

/**
 * Banks the minutes a staff member works past their shift end (or past their
 * check-out, if they already logged out) onto that day's attendance row.
 * Recomputed from the day's latest booking each time, so it stays right when
 * services are added or removed. No attendance row marked = nothing to record.
 */
export const syncStaffOvertime = async (
  client: DbClient,
  input: {
    staffId: string;
    startTime: Date;
    endTime: Date;
    excludeAppointmentId?: string;
  }
) => {
  const staff = await client.staff.findUnique({
    where: { id: input.staffId },
    include: { salon: { select: { timezone: true } } },
  });
  if (!staff) return 0;
  const timezone = staff.salon.timezone;
  const date = dateStringInTimezone(input.endTime, timezone);
  const range = parseSalonDateRange(date, date, timezone);
  if (!range.start || !range.end) return 0;
  const [windows, latest, attendance] = await Promise.all([
    availabilityWindows(client, staff, date),
    client.appointment.findFirst({
      where: {
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        startTime: { gte: range.start, lt: range.end },
        OR: [
          { staffId: staff.id },
          { services: { some: { staffId: staff.id } } },
        ],
        ...(input.excludeAppointmentId
          ? { id: { not: input.excludeAppointmentId } }
          : {}),
      },
      orderBy: { endTime: "desc" },
      select: { endTime: true },
    }),
    client.staffAttendance.findFirst({
      // ponytail: attendance rows are keyed on the salon-local day; a salon
      // whose day straddles UTC midnight can miss the row and record nothing.
      where: { staffId: staff.id, date: parseDateOnly(date) },
      select: { id: true, checkInTime: true, checkOutTime: true },
    }),
  ]);
  const overtimeMinutes = overtimeMinutesFor({
    shiftEnd: windows.length
      ? new Date(
          range.start.getTime() +
            Math.max(...windows.map((window) => window.endTimeMinutes)) * 60_000
        )
      : null,
    checkInTime: attendance?.checkInTime ?? null,
    checkOutTime: attendance?.checkOutTime ?? null,
    latestBookingEnd: latest?.endTime ?? null,
    slotStart: input.startTime,
    slotEnd: input.endTime,
  });
  if (attendance) {
    await client.staffAttendance.update({
      where: { id: attendance.id },
      data: { overtimeMinutes },
    });
  }
  return overtimeMinutes;
};

export const isStaffAvailableForSlot = async (
  staffId: string,
  startTime: Date,
  endTime: Date
) =>
  (
    await checkStaffAvailabilityForSlot({
      staffId,
      startTime,
      endTime,
    })
  ).available;

export const getStaffAvailabilityForDate = async (
  staffId: string,
  date: string,
  client: DbClient = prisma
) => {
  const day = parseDateOnly(date);
  const staff = await client.staff.findUnique({
    where: { id: staffId },
    include: { salon: { select: { timezone: true } } },
  });
  if (!staff) {
    throw new StaffAvailabilityError(404, "Staff member not found");
  }
  const range = parseSalonDateRange(date, date, staff.salon.timezone);
  const [windows, rules, timeBlocks, approvedLeaves, appointments] =
    await Promise.all([
      availabilityWindows(client, staff, date),
      rulesForDate(client, staff.id, date),
      client.staffTimeBlock.findMany({
        where: { staffId, date: day },
        orderBy: { startTime: "asc" },
      }),
      client.staffLeave.findMany({
        where: {
          staffId,
          status: "APPROVED",
          startDate: { lte: day },
          endDate: { gte: day },
        },
        orderBy: { startDate: "asc" },
      }),
      client.appointment.findMany({
        where: {
          staffId,
          status: { notIn: ["CANCELLED", "NO_SHOW"] },
          ...(range.start && range.end
            ? {
                startTime: { lt: range.end },
                endTime: { gt: range.start },
              }
            : {}),
        },
        select: {
          id: true,
          appointmentCode: true,
          startTime: true,
          endTime: true,
          status: true,
        },
        orderBy: { startTime: "asc" },
      }),
    ]);
  return {
    date,
    timezone: staff.salon.timezone,
    staff: {
      id: staff.id,
      name: staff.name,
      branchId: staff.branchId,
      status: staff.status,
    },
    source: rules.length ? ("ROSTER" as const) : ("LEGACY" as const),
    windows,
    rules,
    timeBlocks,
    approvedLeaves,
    appointments,
  };
};

export const calculateAvailableSlots = async (input: {
  client?: DbClient;
  salonId: string;
  branchId: string;
  staff: AvailabilityStaff[];
  date: string;
  timezone: string;
  totalDurationMinutes: number;
  slotIntervalMinutes: number;
  notBefore?: Date;
  notAfter?: Date;
}) => {
  const client = input.client ?? prisma;
  const day = parseDateOnly(input.date);
  const range = parseSalonDateRange(input.date, input.date, input.timezone);
  if (!range.start || !range.end) {
    throw new StaffAvailabilityError(400, "Invalid date");
  }
  const staffIds = input.staff.map((member) => member.id);
  if (!staffIds.length) return [];
  const [rules, blocks, leaves, appointments] = await Promise.all([
    client.staffAvailabilityRule.findMany({
      where: {
        staffId: { in: staffIds },
        dayOfWeek: day.getUTCDay(),
        status: "ACTIVE",
        AND: [
          {
            OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: day } }],
          },
          {
            OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: day } }],
          },
        ],
      },
      orderBy: { startTimeMinutes: "asc" },
    }),
    client.staffTimeBlock.findMany({
      where: {
        staffId: { in: staffIds },
        startTime: { lt: range.end },
        endTime: { gt: range.start },
      },
      select: { staffId: true, startTime: true, endTime: true },
    }),
    client.staffLeave.findMany({
      where: {
        staffId: { in: staffIds },
        status: "APPROVED",
        startDate: { lte: day },
        endDate: { gte: day },
      },
      select: { staffId: true },
    }),
    client.appointment.findMany({
      where: {
        staffId: { in: staffIds },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        startTime: { lt: range.end },
        endTime: { gt: range.start },
      },
      select: { staffId: true, startTime: true, endTime: true },
    }),
  ]);
  const leaveStaff = new Set(leaves.map((leave) => leave.staffId));
  const slots: Array<{
    startTime: string;
    endTime: string;
    staffId: string;
    staffName: string;
  }> = [];

  for (const member of input.staff) {
    if (leaveStaff.has(member.id)) continue;
    const memberRules = rules.filter((rule) => rule.staffId === member.id);
    const windows: AvailabilityWindow[] = memberRules.length
      ? memberRules.map((rule) => ({
          startTimeMinutes: rule.startTimeMinutes,
          endTimeMinutes: rule.endTimeMinutes,
          source: "ROSTER",
          ruleId: rule.id,
        }))
      : fallbackWindows(member, input.date);
    for (const window of windows) {
      const first =
        Math.ceil(window.startTimeMinutes / input.slotIntervalMinutes) *
        input.slotIntervalMinutes;
      for (
        let minute = first;
        minute + input.totalDurationMinutes <= window.endTimeMinutes;
        minute += input.slotIntervalMinutes
      ) {
        const startTime = salonLocalDateTimeToUtc(
          input.date,
          minutesToTime(minute),
          input.timezone
        );
        const endTime = new Date(
          startTime.getTime() + input.totalDurationMinutes * 60_000
        );
        if (
          (input.notBefore && startTime < input.notBefore) ||
          (input.notAfter && startTime > input.notAfter)
        ) {
          continue;
        }
        const blocked = blocks.some(
          (block) =>
            block.staffId === member.id &&
            block.startTime < endTime &&
            block.endTime > startTime
        );
        const occupied = appointments.some(
          (appointment) =>
            appointment.staffId === member.id &&
            appointment.startTime < endTime &&
            appointment.endTime > startTime
        );
        if (!blocked && !occupied) {
          slots.push({
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            staffId: member.id,
            staffName: member.name,
          });
        }
      }
    }
  }
  return slots.sort(
    (left, right) =>
      left.startTime.localeCompare(right.startTime) ||
      left.staffName.localeCompare(right.staffName)
  );
};

export const getAvailableSlots = async (
  actor: StaffAvailabilityActor,
  input: {
    branchId: string;
    serviceIds: string[];
    staffId?: string;
    date: string;
  }
) => {
  const scope = await scopeForActor(prisma, actor);
  if (scope.branchId && scope.branchId !== input.branchId) {
    throw new StaffAvailabilityError(404, "Branch not found");
  }
  const branch = await prisma.branch.findFirst({
    where: {
      id: input.branchId,
      status: true,
      ...(scope.salonId ? { salonId: scope.salonId } : {}),
    },
    include: { salon: { select: { id: true, timezone: true } } },
  });
  if (!branch) {
    throw new StaffAvailabilityError(404, "Branch not found");
  }
  const serviceIds = [...new Set(input.serviceIds)];
  if (!serviceIds.length || serviceIds.length !== input.serviceIds.length) {
    throw new StaffAvailabilityError(
      400,
      "One or more unique serviceIds are required"
    );
  }
  const services = await prisma.service.findMany({
    where: {
      id: { in: serviceIds },
      salonId: branch.salonId,
      status: true,
      OR: [{ branchId: null }, { branchId: branch.id }],
    },
  });
  if (services.length !== serviceIds.length) {
    throw new StaffAvailabilityError(
      400,
      "One or more services are unavailable"
    );
  }
  const selectedStaffId = scope.staffId ?? input.staffId;
  if (scope.staffId && input.staffId && input.staffId !== scope.staffId) {
    throw new StaffAvailabilityError(
      403,
      "Staff can only view their own availability"
    );
  }
  const staff = await prisma.staff.findMany({
    where: {
      salonId: branch.salonId,
      status: true,
      ...(selectedStaffId ? { id: selectedStaffId } : {}),
      OR: [{ branchId: null }, { branchId: branch.id }],
    },
    select: {
      id: true,
      name: true,
      workingFrom: true,
      workingTo: true,
      weekOff: true,
    },
    orderBy: { name: "asc" },
  });
  const totalDurationMinutes = services.reduce(
    (total, service) =>
      total +
      (service.durationValue ?? 0) *
        (service.durationUnit === "HOURS" ? 60 : 1),
    0
  );
  if (totalDurationMinutes <= 0) {
    throw new StaffAvailabilityError(
      400,
      "Selected services have no bookable duration"
    );
  }
  return {
    date: input.date,
    timezone: branch.salon.timezone,
    totalDurationMinutes,
    slots: await calculateAvailableSlots({
      salonId: branch.salonId,
      branchId: branch.id,
      staff,
      date: input.date,
      timezone: branch.salon.timezone,
      totalDurationMinutes,
      slotIntervalMinutes: 15,
    }),
  };
};

export const getAvailableStaffForService = async (
  actor: StaffAvailabilityActor,
  branchId: string,
  serviceId: string,
  date: string
) => {
  const result = await getAvailableSlots(actor, {
    branchId,
    serviceIds: [serviceId],
    date,
  });
  const seen = new Map<string, { id: string; name: string }>();
  for (const slot of result.slots) {
    seen.set(slot.staffId, { id: slot.staffId, name: slot.staffName });
  }
  return [...seen.values()].sort((left, right) =>
    left.name.localeCompare(right.name)
  );
};

export const listAvailabilityRules = async (
  actor: StaffAvailabilityActor,
  filters: {
    salonId?: string;
    branchId?: string;
    staffId?: string;
    dayOfWeek?: number;
    status?: StaffAvailabilityStatus;
  }
) => {
  const scope = await scopeForActor(prisma, actor);
  if (
    (scope.salonId && filters.salonId && scope.salonId !== filters.salonId) ||
    (scope.branchId && filters.branchId && scope.branchId !== filters.branchId) ||
    (scope.staffId && filters.staffId && scope.staffId !== filters.staffId)
  ) {
    throw new StaffAvailabilityError(404, "Roster entries not found");
  }
  return prisma.staffAvailabilityRule.findMany({
    where: {
      ...(scope.salonId
        ? { salonId: scope.salonId }
        : filters.salonId
          ? { salonId: filters.salonId }
          : {}),
      ...(scope.branchId
        ? { branchId: scope.branchId }
        : filters.branchId
          ? { branchId: filters.branchId }
          : {}),
      ...(scope.staffId
        ? { staffId: scope.staffId }
        : filters.staffId
          ? { staffId: filters.staffId }
          : {}),
      ...(filters.dayOfWeek !== undefined
        ? { dayOfWeek: filters.dayOfWeek }
        : {}),
      ...(filters.status ? { status: filters.status } : {}),
    },
    include: ruleInclude,
    orderBy: [
      { staff: { name: "asc" } },
      { dayOfWeek: "asc" },
      { startTimeMinutes: "asc" },
    ],
  });
};

export const getAvailabilityRule = async (
  actor: StaffAvailabilityActor,
  id: string,
  client: DbClient = prisma
) => {
  const scope = await scopeForActor(client, actor);
  const rule = await client.staffAvailabilityRule.findFirst({
    where: {
      id,
      ...(scope.salonId ? { salonId: scope.salonId } : {}),
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      ...(scope.staffId ? { staffId: scope.staffId } : {}),
    },
    include: ruleInclude,
  });
  if (!rule) {
    throw new StaffAvailabilityError(404, "Availability rule not found");
  }
  return rule;
};

export const createAvailabilityRule = async (
  actor: StaffAvailabilityActor,
  input: {
    branchId: string;
    staffId: string;
    dayOfWeek: number;
    startTimeMinutes: number;
    endTimeMinutes: number;
    effectiveFrom?: Date | null;
    effectiveUntil?: Date | null;
    status?: StaffAvailabilityStatus;
  },
  audit: AuditContext
) => {
  requireMutationRole(actor);
  const effectiveFrom = input.effectiveFrom ?? null;
  const effectiveUntil = input.effectiveUntil ?? null;
  const status = input.status ?? "ACTIVE";
  validateRuleValues({ ...input, effectiveFrom, effectiveUntil });
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Staff" WHERE "id" = ${input.staffId} FOR UPDATE`;
    const staff = await requireStaffTarget(
      tx,
      actor,
      input.staffId,
      input.branchId
    );
    await assertNoRuleOverlap(tx, {
      ...input,
      effectiveFrom,
      effectiveUntil,
      status,
    });
    const created = await tx.staffAvailabilityRule.create({
      data: {
        salonId: staff.salonId,
        branchId: input.branchId,
        staffId: input.staffId,
        dayOfWeek: input.dayOfWeek,
        startTimeMinutes: input.startTimeMinutes,
        endTimeMinutes: input.endTimeMinutes,
        effectiveFrom,
        effectiveUntil,
        status,
        createdById: actor.userId,
      },
      include: ruleInclude,
    });
    await createAuditLog({
      tx,
      salonId: created.salonId,
      branchId: created.branchId,
      userId: actor.userId,
      module: "STAFF",
      action: "CREATE",
      entityId: created.id,
      entityName: created.staff.name,
      description: `Staff availability rule created for ${created.staff.name}`,
      newData: {
        staffId: created.staffId,
        dayOfWeek: created.dayOfWeek,
        startTimeMinutes: created.startTimeMinutes,
        endTimeMinutes: created.endTimeMinutes,
        effectiveFrom: created.effectiveFrom,
        effectiveUntil: created.effectiveUntil,
        status: created.status,
      },
      ...audit,
    });
    return created;
  });
};

export const updateAvailabilityRule = async (
  actor: StaffAvailabilityActor,
  id: string,
  input: {
    branchId?: string;
    staffId?: string;
    dayOfWeek?: number;
    startTimeMinutes?: number;
    endTimeMinutes?: number;
    effectiveFrom?: Date | null;
    effectiveUntil?: Date | null;
    status?: StaffAvailabilityStatus;
  },
  audit: AuditContext
) => {
  requireMutationRole(actor);
  return prisma.$transaction(async (tx) => {
    const existing = await getAvailabilityRule(actor, id, tx);
    const staffId = input.staffId ?? existing.staffId;
    const branchId = input.branchId ?? existing.branchId;
    await tx.$queryRaw`SELECT "id" FROM "Staff" WHERE "id" = ${staffId} FOR UPDATE`;
    const staff = await requireStaffTarget(tx, actor, staffId, branchId);
    const next = {
      dayOfWeek: input.dayOfWeek ?? existing.dayOfWeek,
      startTimeMinutes:
        input.startTimeMinutes ?? existing.startTimeMinutes,
      endTimeMinutes: input.endTimeMinutes ?? existing.endTimeMinutes,
      effectiveFrom:
        input.effectiveFrom === undefined
          ? existing.effectiveFrom
          : input.effectiveFrom,
      effectiveUntil:
        input.effectiveUntil === undefined
          ? existing.effectiveUntil
          : input.effectiveUntil,
      status: input.status ?? existing.status,
    };
    validateRuleValues(next);
    await assertNoRuleOverlap(tx, {
      staffId,
      ...next,
      excludeId: existing.id,
    });
    const updated = await tx.staffAvailabilityRule.update({
      where: { id },
      data: {
        salonId: staff.salonId,
        branchId,
        staffId,
        ...next,
      },
      include: ruleInclude,
    });
    await createAuditLog({
      tx,
      salonId: updated.salonId,
      branchId: updated.branchId,
      userId: actor.userId,
      module: "STAFF",
      action: "UPDATE",
      entityId: updated.id,
      entityName: updated.staff.name,
      description: `Staff availability rule updated for ${updated.staff.name}`,
      oldData: {
        staffId: existing.staffId,
        dayOfWeek: existing.dayOfWeek,
        startTimeMinutes: existing.startTimeMinutes,
        endTimeMinutes: existing.endTimeMinutes,
        effectiveFrom: existing.effectiveFrom,
        effectiveUntil: existing.effectiveUntil,
        status: existing.status,
      },
      newData: {
        staffId: updated.staffId,
        dayOfWeek: updated.dayOfWeek,
        startTimeMinutes: updated.startTimeMinutes,
        endTimeMinutes: updated.endTimeMinutes,
        effectiveFrom: updated.effectiveFrom,
        effectiveUntil: updated.effectiveUntil,
        status: updated.status,
      },
      ...audit,
    });
    return updated;
  });
};

export const setAvailabilityRuleStatus = async (
  actor: StaffAvailabilityActor,
  id: string,
  status: StaffAvailabilityStatus,
  audit: AuditContext
) => {
  requireMutationRole(actor);
  return prisma.$transaction(async (tx) => {
    const existing = await getAvailabilityRule(actor, id, tx);
    if (status === "ACTIVE") {
      await tx.$queryRaw`SELECT "id" FROM "Staff" WHERE "id" = ${existing.staffId} FOR UPDATE`;
      await assertNoRuleOverlap(tx, {
        staffId: existing.staffId,
        dayOfWeek: existing.dayOfWeek,
        startTimeMinutes: existing.startTimeMinutes,
        endTimeMinutes: existing.endTimeMinutes,
        effectiveFrom: existing.effectiveFrom,
        effectiveUntil: existing.effectiveUntil,
        status,
        excludeId: existing.id,
      });
    }
    const updated = await tx.staffAvailabilityRule.update({
      where: { id },
      data: { status },
      include: ruleInclude,
    });
    await createAuditLog({
      tx,
      salonId: updated.salonId,
      branchId: updated.branchId,
      userId: actor.userId,
      module: "STAFF",
      action: "STATUS_CHANGE",
      entityId: updated.id,
      entityName: updated.staff.name,
      description: `Staff availability rule ${status.toLowerCase()} for ${updated.staff.name}`,
      oldData: { status: existing.status },
      newData: { status },
      ...audit,
    });
    return updated;
  });
};

export const deleteAvailabilityRule = async (
  actor: StaffAvailabilityActor,
  id: string,
  audit: AuditContext
) => {
  requireMutationRole(actor);
  return prisma.$transaction(async (tx) => {
    const existing = await getAvailabilityRule(actor, id, tx);
    await tx.staffAvailabilityRule.delete({ where: { id } });
    await createAuditLog({
      tx,
      salonId: existing.salonId,
      branchId: existing.branchId,
      userId: actor.userId,
      module: "STAFF",
      action: "DELETE",
      entityId: existing.id,
      entityName: existing.staff.name,
      description: `Staff availability rule deleted for ${existing.staff.name}`,
      oldData: {
        staffId: existing.staffId,
        dayOfWeek: existing.dayOfWeek,
        startTimeMinutes: existing.startTimeMinutes,
        endTimeMinutes: existing.endTimeMinutes,
        effectiveFrom: existing.effectiveFrom,
        effectiveUntil: existing.effectiveUntil,
        status: existing.status,
      },
      ...audit,
    });
    return existing;
  });
};

const validateTimeBlockDates = (
  date: Date,
  startTime: Date,
  endTime: Date,
  timezone: string
) => {
  if (
    Number.isNaN(startTime.getTime()) ||
    Number.isNaN(endTime.getTime()) ||
    startTime >= endTime
  ) {
    throw new StaffAvailabilityError(
      400,
      "Time block start must be before end"
    );
  }
  const expected = date.toISOString().slice(0, 10);
  if (
    dateStringInTimezone(startTime, timezone) !== expected ||
    dateStringInTimezone(endTime, timezone) !== expected
  ) {
    throw new StaffAvailabilityError(
      400,
      "Time block start and end must fall on its salon-local date"
    );
  }
};

const assertNoTimeBlockOverlap = async (
  client: DbClient,
  input: {
    staffId: string;
    startTime: Date;
    endTime: Date;
    excludeId?: string;
  }
) => {
  const overlap = await client.staffTimeBlock.findFirst({
    where: {
      staffId: input.staffId,
      startTime: { lt: input.endTime },
      endTime: { gt: input.startTime },
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
    },
    select: { id: true },
  });
  if (overlap) {
    throw new StaffAvailabilityError(
      409,
      "Time block overlaps an existing block"
    );
  }
};

export const listTimeBlocks = async (
  actor: StaffAvailabilityActor,
  filters: {
    salonId?: string;
    branchId?: string;
    staffId?: string;
    startDate?: Date;
    endDate?: Date;
  }
) => {
  const scope = await scopeForActor(prisma, actor);
  if (
    (scope.salonId && filters.salonId && scope.salonId !== filters.salonId) ||
    (scope.branchId && filters.branchId && scope.branchId !== filters.branchId) ||
    (scope.staffId && filters.staffId && scope.staffId !== filters.staffId)
  ) {
    throw new StaffAvailabilityError(404, "Time blocks not found");
  }
  return prisma.staffTimeBlock.findMany({
    where: {
      ...(scope.salonId
        ? { salonId: scope.salonId }
        : filters.salonId
          ? { salonId: filters.salonId }
          : {}),
      ...(scope.branchId
        ? { branchId: scope.branchId }
        : filters.branchId
          ? { branchId: filters.branchId }
          : {}),
      ...(scope.staffId
        ? { staffId: scope.staffId }
        : filters.staffId
          ? { staffId: filters.staffId }
          : {}),
      ...(filters.startDate || filters.endDate
        ? {
            date: {
              ...(filters.startDate ? { gte: filters.startDate } : {}),
              ...(filters.endDate ? { lte: filters.endDate } : {}),
            },
          }
        : {}),
    },
    include: blockInclude,
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });
};

export const getTimeBlock = async (
  actor: StaffAvailabilityActor,
  id: string,
  client: DbClient = prisma
) => {
  const scope = await scopeForActor(client, actor);
  const block = await client.staffTimeBlock.findFirst({
    where: {
      id,
      ...(scope.salonId ? { salonId: scope.salonId } : {}),
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      ...(scope.staffId ? { staffId: scope.staffId } : {}),
    },
    include: blockInclude,
  });
  if (!block) {
    throw new StaffAvailabilityError(404, "Time block not found");
  }
  return block;
};

export const createTimeBlock = async (
  actor: StaffAvailabilityActor,
  input: {
    branchId: string;
    staffId: string;
    date: Date;
    startTime: Date;
    endTime: Date;
    type: StaffTimeBlockType;
    note?: string;
  },
  audit: AuditContext
) => {
  requireMutationRole(actor);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Staff" WHERE "id" = ${input.staffId} FOR UPDATE`;
    const staff = await requireStaffTarget(
      tx,
      actor,
      input.staffId,
      input.branchId
    );
    validateTimeBlockDates(
      input.date,
      input.startTime,
      input.endTime,
      staff.salon.timezone
    );
    await assertNoTimeBlockOverlap(tx, input);
    const created = await tx.staffTimeBlock.create({
      data: {
        salonId: staff.salonId,
        branchId: input.branchId,
        staffId: input.staffId,
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime,
        type: input.type,
        ...(input.note ? { note: input.note } : {}),
        createdById: actor.userId,
      },
      include: blockInclude,
    });
    await createAuditLog({
      tx,
      salonId: created.salonId,
      branchId: created.branchId,
      userId: actor.userId,
      module: "STAFF",
      action: "CREATE",
      entityId: created.id,
      entityName: created.staff.name,
      description: `Staff time block created for ${created.staff.name}`,
      newData: {
        staffId: created.staffId,
        date: created.date,
        startTime: created.startTime,
        endTime: created.endTime,
        type: created.type,
        note: created.note,
      },
      ...audit,
    });
    return created;
  });
};

export const updateTimeBlock = async (
  actor: StaffAvailabilityActor,
  id: string,
  input: {
    branchId?: string;
    staffId?: string;
    date?: Date;
    startTime?: Date;
    endTime?: Date;
    type?: StaffTimeBlockType;
    note?: string | null;
  },
  audit: AuditContext
) => {
  requireMutationRole(actor);
  return prisma.$transaction(async (tx) => {
    const existing = await getTimeBlock(actor, id, tx);
    const staffId = input.staffId ?? existing.staffId;
    const branchId = input.branchId ?? existing.branchId;
    await tx.$queryRaw`SELECT "id" FROM "Staff" WHERE "id" = ${staffId} FOR UPDATE`;
    const staff = await requireStaffTarget(tx, actor, staffId, branchId);
    const next = {
      date: input.date ?? existing.date,
      startTime: input.startTime ?? existing.startTime,
      endTime: input.endTime ?? existing.endTime,
      type: input.type ?? existing.type,
      note: input.note === undefined ? existing.note : input.note,
    };
    validateTimeBlockDates(
      next.date,
      next.startTime,
      next.endTime,
      staff.salon.timezone
    );
    await assertNoTimeBlockOverlap(tx, {
      staffId,
      startTime: next.startTime,
      endTime: next.endTime,
      excludeId: existing.id,
    });
    const updated = await tx.staffTimeBlock.update({
      where: { id },
      data: {
        salonId: staff.salonId,
        branchId,
        staffId,
        ...next,
      },
      include: blockInclude,
    });
    await createAuditLog({
      tx,
      salonId: updated.salonId,
      branchId: updated.branchId,
      userId: actor.userId,
      module: "STAFF",
      action: "UPDATE",
      entityId: updated.id,
      entityName: updated.staff.name,
      description: `Staff time block updated for ${updated.staff.name}`,
      oldData: {
        staffId: existing.staffId,
        date: existing.date,
        startTime: existing.startTime,
        endTime: existing.endTime,
        type: existing.type,
        note: existing.note,
      },
      newData: {
        staffId: updated.staffId,
        date: updated.date,
        startTime: updated.startTime,
        endTime: updated.endTime,
        type: updated.type,
        note: updated.note,
      },
      ...audit,
    });
    return updated;
  });
};

export const deleteTimeBlock = async (
  actor: StaffAvailabilityActor,
  id: string,
  audit: AuditContext
) => {
  requireMutationRole(actor);
  return prisma.$transaction(async (tx) => {
    const existing = await getTimeBlock(actor, id, tx);
    await tx.staffTimeBlock.delete({ where: { id } });
    await createAuditLog({
      tx,
      salonId: existing.salonId,
      branchId: existing.branchId,
      userId: actor.userId,
      module: "STAFF",
      action: "DELETE",
      entityId: existing.id,
      entityName: existing.staff.name,
      description: `Staff time block deleted for ${existing.staff.name}`,
      oldData: {
        staffId: existing.staffId,
        date: existing.date,
        startTime: existing.startTime,
        endTime: existing.endTime,
        type: existing.type,
        note: existing.note,
      },
      ...audit,
    });
    return existing;
  });
};

export const getStaffRoster = async (
  actor: StaffAvailabilityActor,
  input: {
    salonId?: string;
    branchId?: string;
    staffId?: string;
    startDate: string;
    endDate: string;
  }
) => {
  const startDate = parseDateOnly(input.startDate);
  const endDate = parseDateOnly(input.endDate);
  if (startDate > endDate) {
    throw new StaffAvailabilityError(
      400,
      "startDate cannot be later than endDate"
    );
  }
  const scope = await scopeForActor(prisma, actor);
  if (
    (scope.salonId && input.salonId && scope.salonId !== input.salonId) ||
    (scope.branchId && input.branchId && scope.branchId !== input.branchId) ||
    (scope.staffId && input.staffId && scope.staffId !== input.staffId)
  ) {
    throw new StaffAvailabilityError(404, "Staff roster not found");
  }
  const staffWhere: Prisma.StaffWhereInput = {
    ...(scope.salonId
      ? { salonId: scope.salonId }
      : input.salonId
        ? { salonId: input.salonId }
        : {}),
    ...(scope.branchId
      ? { branchId: scope.branchId }
      : input.branchId
        ? { branchId: input.branchId }
        : {}),
    ...(scope.staffId
      ? { id: scope.staffId }
      : input.staffId
        ? { id: input.staffId }
        : {}),
  };
  const staff = await prisma.staff.findMany({
    where: staffWhere,
    select: {
      id: true,
      staffCode: true,
      name: true,
      jobRole: true,
      salonId: true,
      branchId: true,
      workingFrom: true,
      workingTo: true,
      weekOff: true,
      status: true,
      branch: { select: { id: true, name: true } },
    },
    orderBy: { name: "asc" },
  });
  const staffIds = staff.map((member) => member.id);
  const [rules, timeBlocks, approvedLeaves] = await Promise.all([
    prisma.staffAvailabilityRule.findMany({
      where: {
        staffId: { in: staffIds },
        OR: [
          { effectiveFrom: null },
          { effectiveFrom: { lte: endDate } },
        ],
        AND: [
          {
            OR: [
              { effectiveUntil: null },
              { effectiveUntil: { gte: startDate } },
            ],
          },
        ],
      },
      include: ruleInclude,
      orderBy: [
        { staff: { name: "asc" } },
        { dayOfWeek: "asc" },
        { startTimeMinutes: "asc" },
      ],
    }),
    prisma.staffTimeBlock.findMany({
      where: {
        staffId: { in: staffIds },
        date: { gte: startDate, lte: endDate },
      },
      include: blockInclude,
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    }),
    prisma.staffLeave.findMany({
      where: {
        staffId: { in: staffIds },
        status: "APPROVED",
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
      include: {
        staff: { select: { id: true, name: true } },
      },
      orderBy: { startDate: "asc" },
    }),
  ]);
  return {
    startDate: input.startDate,
    endDate: input.endDate,
    staff,
    rules,
    timeBlocks,
    approvedLeaves,
  };
};
