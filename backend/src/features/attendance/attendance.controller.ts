import { type Request, type Response } from "express";
import { applyBranchSession } from "../../utils/branch-scope.js";
import type { AttendanceStatus } from "../../generated/prisma/enums.js";
import { AttendanceModel } from "./attendance.model.js";

const ATTENDANCE_STATUSES = [
  "PRESENT",
  "ABSENT",
  "HALF_DAY",
  "LATE",
  "WEEK_OFF",
  "PAID_LEAVE",
  "UNPAID_LEAVE",
] as const satisfies readonly AttendanceStatus[];

const DEFAULT_GRACE_MINUTES = 10;

type StaffRecord = NonNullable<
  Awaited<ReturnType<typeof AttendanceModel.findStaffById>>
>;

type StaffAccessResult =
  | { staff: StaffRecord }
  | { status: number; message: string };

const isAttendanceStatus = (value: unknown): value is AttendanceStatus =>
  typeof value === "string" &&
  ATTENDANCE_STATUSES.includes(value as AttendanceStatus);

const getString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const parseDate = (value: unknown): Date | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? null
    : date;
};

const dateFromTimestamp = (timestamp: Date) =>
  new Date(`${timestamp.toISOString().slice(0, 10)}T00:00:00.000Z`);

const parseTimestamp = (value: unknown, fallback?: Date): Date | null => {
  if (value === undefined && fallback) {
    return fallback;
  }

  if (typeof value !== "string") {
    return null;
  }

  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
};

const calculateLateMinutes = (
  workingFrom: string,
  checkInTime: Date,
  graceMinutes = DEFAULT_GRACE_MINUTES
) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(workingFrom.trim());

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) {
    return null;
  }

  const scheduledMinutes = hours * 60 + minutes + graceMinutes;
  const actualMinutes =
    checkInTime.getUTCHours() * 60 +
    checkInTime.getUTCMinutes() +
    checkInTime.getUTCSeconds() / 60 +
    checkInTime.getUTCMilliseconds() / 60_000;

  return Math.max(0, Math.ceil(actualMinutes - scheduledMinutes));
};

const isBranchScopedRole = (role: string | undefined) =>
  role === "BRANCH_MANAGER" || role === "RECEPTIONIST";

const resolveAccessibleStaff = async (
  req: Request,
  requestedStaffId?: string,
  requestedSalonId?: string
): Promise<StaffAccessResult> => {
  if (!req.user) {
    return { status: 401, message: "Unauthorized" };
  }

  let staff: StaffRecord | null;

  if (req.user.role === "STAFF") {
    staff = await AttendanceModel.findStaffByUserId(req.user.userId);

    if (!staff) {
      return { status: 404, message: "Staff profile not found for this user" };
    }

    if (requestedStaffId && requestedStaffId !== staff.id) {
      return { status: 403, message: "Staff can only access their own attendance" };
    }
  } else {
    if (!requestedStaffId) {
      return { status: 400, message: "staffId is required" };
    }

    staff = await AttendanceModel.findStaffById(requestedStaffId);

    if (!staff) {
      return { status: 404, message: "Staff not found" };
    }
  }

  if (req.user.role === "SUPER_ADMIN") {
    if (requestedSalonId && requestedSalonId !== staff.salonId) {
      return { status: 403, message: "Staff does not belong to the selected salon" };
    }

    return { staff };
  }

  if (!req.user.salonId) {
    return { status: 400, message: "Salon ID is missing" };
  }

  if (staff.salonId !== req.user.salonId) {
    return { status: 403, message: "Staff does not belong to your salon" };
  }

  if (
    isBranchScopedRole(req.user.role) &&
    req.user.branchId &&
    staff.branchId !== req.user.branchId
  ) {
    return { status: 403, message: "Staff does not belong to your branch" };
  }

  return { staff };
};

const sendStaffAccessError = (res: Response, result: StaffAccessResult) => {
  if ("staff" in result) {
    return false;
  }

  res.status(result.status).json({ success: false, message: result.message });
  return true;
};

const validateBranch = async (
  req: Request,
  staff: StaffRecord,
  requestedBranchId?: string
) => {
  const branchId = requestedBranchId ?? staff.branchId ?? undefined;

  if (!branchId) {
    return { branchId: undefined };
  }

  if (staff.branchId && requestedBranchId && requestedBranchId !== staff.branchId) {
    return { status: 400, message: "branchId does not match the staff branch" };
  }

  if (
    isBranchScopedRole(req.user?.role) &&
    req.user?.branchId &&
    branchId !== req.user.branchId
  ) {
    return { status: 403, message: "You do not have access to this branch" };
  }

  const branch = await AttendanceModel.findBranchById(branchId);

  if (!branch || branch.salonId !== staff.salonId) {
    return { status: 400, message: "Branch does not belong to the staff salon" };
  }

  return { branchId };
};

export const checkIn = async (req: Request, res: Response) => {
  try {
    const staffId = getString(req.body.staffId);
    const salonId = getString(req.body.salonId);
    const access = await resolveAccessibleStaff(req, staffId, salonId);

    if (sendStaffAccessError(res, access) || !("staff" in access)) {
      return;
    }

    const branch = await validateBranch(req, access.staff, getString(req.body.branchId));

    if ("status" in branch) {
      return res.status(branch.status).json({ success: false, message: branch.message });
    }

    const checkInTime = parseTimestamp(req.body.checkInTime, new Date());

    if (!checkInTime) {
      return res.status(400).json({ success: false, message: "Invalid checkInTime" });
    }

    const requestedDate = req.body.date === undefined ? undefined : parseDate(req.body.date);

    if (req.body.date !== undefined && !requestedDate) {
      return res.status(400).json({ success: false, message: "date must use YYYY-MM-DD" });
    }

    const date = requestedDate ?? dateFromTimestamp(checkInTime);
    const salaryConfig = await AttendanceModel.findSalaryConfigForDate(
      access.staff.id,
      checkInTime
    );
    const lateMinutes = calculateLateMinutes(
      access.staff.workingFrom,
      checkInTime,
      salaryConfig?.lateGraceMinutes ?? DEFAULT_GRACE_MINUTES
    );
    const note = getString(req.body.note);

    if (lateMinutes === null) {
      return res.status(400).json({
        success: false,
        message: "Staff workingFrom must use HH:mm format",
      });
    }

    const attendance = await AttendanceModel.upsertCheckIn({
      salonId: access.staff.salonId,
      staffId: access.staff.id,
      date,
      checkInTime,
      status: lateMinutes > 0 ? "LATE" : "PRESENT",
      lateMinutes,
      ...(branch.branchId ? { branchId: branch.branchId } : {}),
      ...(note ? { note } : {}),
      ...(req.user?.userId ? { markedById: req.user.userId } : {}),
    });

    return res.status(200).json({
      success: true,
      message: "Check-in recorded successfully",
      data: attendance,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const checkOut = async (req: Request, res: Response) => {
  try {
    const access = await resolveAccessibleStaff(
      req,
      getString(req.body.staffId),
      getString(req.body.salonId)
    );

    if (sendStaffAccessError(res, access) || !("staff" in access)) {
      return;
    }

    const checkOutTime = parseTimestamp(req.body.checkOutTime, new Date());

    if (!checkOutTime) {
      return res.status(400).json({ success: false, message: "Invalid checkOutTime" });
    }

    const requestedDate = req.body.date === undefined ? undefined : parseDate(req.body.date);

    if (req.body.date !== undefined && !requestedDate) {
      return res.status(400).json({ success: false, message: "date must use YYYY-MM-DD" });
    }

    const date = requestedDate ?? dateFromTimestamp(checkOutTime);
    const existing = await AttendanceModel.findByStaffAndDate(
      access.staff.salonId,
      access.staff.id,
      date
    );

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Attendance check-in not found for this date",
      });
    }

    if (existing.checkInTime && checkOutTime < existing.checkInTime) {
      return res.status(400).json({
        success: false,
        message: "checkOutTime cannot be earlier than checkInTime",
      });
    }

    const attendance = await AttendanceModel.checkOut(
      existing.id,
      checkOutTime,
      req.user?.userId
    );

    return res.status(200).json({
      success: true,
      message: "Check-out recorded successfully",
      data: attendance,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const markAttendance = async (req: Request, res: Response) => {
  try {
    const access = await resolveAccessibleStaff(
      req,
      getString(req.body.staffId),
      getString(req.body.salonId)
    );

    if (sendStaffAccessError(res, access) || !("staff" in access)) {
      return;
    }

    const date = parseDate(req.body.date);

    if (!date) {
      return res.status(400).json({
        success: false,
        message: "date is required and must use YYYY-MM-DD",
      });
    }

    if (!isAttendanceStatus(req.body.status)) {
      return res.status(400).json({ success: false, message: "Invalid attendance status" });
    }

    const branch = await validateBranch(req, access.staff, getString(req.body.branchId));

    if ("status" in branch) {
      return res.status(branch.status).json({ success: false, message: branch.message });
    }

    const checkInTime: Date | null | undefined =
      req.body.checkInTime === undefined || req.body.checkInTime === null
        ? req.body.checkInTime
        : parseTimestamp(req.body.checkInTime);
    const checkOutTime: Date | null | undefined =
      req.body.checkOutTime === undefined || req.body.checkOutTime === null
        ? req.body.checkOutTime
        : parseTimestamp(req.body.checkOutTime);

    if (checkInTime === null && req.body.checkInTime !== null) {
      return res.status(400).json({ success: false, message: "Invalid checkInTime" });
    }

    if (checkOutTime === null && req.body.checkOutTime !== null) {
      return res.status(400).json({ success: false, message: "Invalid checkOutTime" });
    }

    if (checkInTime instanceof Date && checkOutTime instanceof Date && checkOutTime < checkInTime) {
      return res.status(400).json({
        success: false,
        message: "checkOutTime cannot be earlier than checkInTime",
      });
    }

    const suppliedLateMinutes = Number(req.body.lateMinutes ?? 0);

    if (!Number.isInteger(suppliedLateMinutes) || suppliedLateMinutes < 0) {
      return res.status(400).json({
        success: false,
        message: "lateMinutes must be a non-negative integer",
      });
    }

    const note = getString(req.body.note);
    const status: AttendanceStatus = req.body.status;

    const attendance = await AttendanceModel.upsertManual({
      salonId: access.staff.salonId,
      staffId: access.staff.id,
      date,
      status,
      lateMinutes: status === "LATE" ? suppliedLateMinutes : 0,
      ...(branch.branchId ? { branchId: branch.branchId } : {}),
      ...(checkInTime !== undefined ? { checkInTime } : {}),
      ...(checkOutTime !== undefined ? { checkOutTime } : {}),
      ...(req.body.note === null
        ? { note: null }
        : note
          ? { note }
          : {}),
      ...(req.user?.userId ? { markedById: req.user.userId } : {}),
    });

    return res.status(200).json({
      success: true,
      message: "Attendance marked successfully",
      data: attendance,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const buildListFilters = async (req: Request, forcedStaffId?: string) => {
  const statusValue = getString(req.query.status);

  if (statusValue && !isAttendanceStatus(statusValue)) {
    return { error: { status: 400, message: "Invalid attendance status" } };
  }

  const status: AttendanceStatus | undefined =
    statusValue && isAttendanceStatus(statusValue) ? statusValue : undefined;

  const fromValue = getString(req.query.from);
  const toValue = getString(req.query.to);
  const dateValue = getString(req.query.date);
  const dateFrom = dateValue ? parseDate(dateValue) : fromValue ? parseDate(fromValue) : undefined;
  const dateTo = dateValue ? parseDate(dateValue) : toValue ? parseDate(toValue) : undefined;

  if ((dateValue && !dateFrom) || (fromValue && !dateFrom) || (toValue && !dateTo)) {
    return { error: { status: 400, message: "date, from and to must use YYYY-MM-DD" } };
  }

  if (dateFrom && dateTo && dateFrom > dateTo) {
    return { error: { status: 400, message: "from cannot be later than to" } };
  }

  if (!req.user) {
    return { error: { status: 401, message: "Unauthorized" } };
  }

  let staffId = forcedStaffId ?? getString(req.query.staffId);
  let salonId = getString(req.query.salonId);
  let branchId = getString(req.query.branchId);

  if (req.user.role === "STAFF") {
    const access = await resolveAccessibleStaff(req, staffId);

    if (!("staff" in access)) {
      return { error: access };
    }

    staffId = access.staff.id;
    salonId = access.staff.salonId;
    branchId = access.staff.branchId ?? undefined;
  } else if (staffId) {
    const access = await resolveAccessibleStaff(req, staffId, salonId);

    if (!("staff" in access)) {
      return { error: access };
    }

    salonId = access.staff.salonId;
  }

  if (req.user.role !== "SUPER_ADMIN") {
    if (!req.user.salonId) {
      return { error: { status: 400, message: "Salon ID is missing" } };
    }

    if (salonId && salonId !== req.user.salonId) {
      return { error: { status: 403, message: "You do not have access to this salon" } };
    }

    salonId = req.user.salonId;
  }

  if (isBranchScopedRole(req.user.role) && req.user.branchId) {
    if (branchId && branchId !== req.user.branchId) {
      return { error: { status: 403, message: "You do not have access to this branch" } };
    }

    branchId = req.user.branchId;
  }

  branchId = applyBranchSession(req, branchId);

  if (branchId) {
    const branch = await AttendanceModel.findBranchById(branchId);

    if (!branch || (salonId && branch.salonId !== salonId)) {
      return { error: { status: 400, message: "Branch does not belong to the selected salon" } };
    }
  }

  return {
    filters: {
      ...(salonId ? { salonId } : {}),
      ...(branchId ? { branchId } : {}),
      ...(staffId ? { staffId } : {}),
      ...(status ? { status } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
    },
  };
};

const sendAttendanceList = async (
  req: Request,
  res: Response,
  forcedStaffId?: string
) => {
  try {
    const result = await buildListFilters(req, forcedStaffId);

    if ("error" in result) {
      return res.status(result.error.status).json({
        success: false,
        message: result.error.message,
      });
    }

    const attendance = await AttendanceModel.findMany(result.filters);

    return res.status(200).json({
      success: true,
      message: "Attendance fetched successfully",
      data: attendance,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const getAttendance = async (req: Request, res: Response) =>
  sendAttendanceList(req, res);

export const getStaffAttendance = async (req: Request, res: Response) => {
  const staffId = getString(req.params.staffId);

  if (!staffId) {
    return res.status(400).json({ success: false, message: "staffId is required" });
  }

  return sendAttendanceList(req, res, staffId);
};
