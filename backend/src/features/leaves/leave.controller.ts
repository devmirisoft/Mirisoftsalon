import { type Request, type Response } from "express";
import { applyBranchSession } from "../../utils/branch-scope.js";
import type { LeaveStatus, LeaveType } from "../../generated/prisma/enums.js";
import { LeaveModel } from "./leave.model.js";

const LEAVE_TYPES = [
  "PAID_LEAVE",
  "UNPAID_LEAVE",
  "SICK_LEAVE",
  "CASUAL_LEAVE",
  "OTHER",
] as const satisfies readonly LeaveType[];

const LEAVE_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
] as const satisfies readonly LeaveStatus[];

type StaffRecord = NonNullable<Awaited<ReturnType<typeof LeaveModel.findStaffById>>>;
type LeaveRecord = NonNullable<Awaited<ReturnType<typeof LeaveModel.findById>>>;
type AccessError = { status: number; message: string };
type StaffAccess = { staff: StaffRecord } | AccessError;
type LeaveAccess = { leave: LeaveRecord } | AccessError;
type BranchAccess = { branchId: string | undefined } | AccessError;

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

const isLeaveType = (value: unknown): value is LeaveType =>
  typeof value === "string" && LEAVE_TYPES.includes(value as LeaveType);

const isLeaveStatus = (value: unknown): value is LeaveStatus =>
  typeof value === "string" && LEAVE_STATUSES.includes(value as LeaveStatus);

const isSelfServiceRole = (role: string | undefined) =>
  role === "STAFF" || role === "RECEPTIONIST";

const isBranchManagedRole = (role: string | undefined) =>
  role === "BRANCH_MANAGER" || role === "RECEPTIONIST";

const getIdParam = (req: Request) => getString(req.params.id);

const resolveTargetStaff = async (
  req: Request,
  requestedStaffId?: string,
  requestedSalonId?: string
): Promise<StaffAccess> => {
  if (!req.user) {
    return { status: 401, message: "Unauthorized" };
  }

  let staff: StaffRecord | null;

  if (isSelfServiceRole(req.user.role)) {
    staff = await LeaveModel.findStaffByUserId(req.user.userId);

    if (!staff) {
      return { status: 404, message: "Staff profile not found for this user" };
    }

    if (requestedStaffId && requestedStaffId !== staff.id) {
      return { status: 403, message: "You can only request or view your own leave" };
    }
  } else {
    if (!requestedStaffId) {
      return { status: 400, message: "staffId is required" };
    }

    staff = await LeaveModel.findStaffById(requestedStaffId);

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
    isBranchManagedRole(req.user.role) &&
    req.user.branchId &&
    staff.branchId !== req.user.branchId
  ) {
    return { status: 403, message: "Staff does not belong to your branch" };
  }

  return { staff };
};

const resolveBranch = async (
  req: Request,
  staff: StaffRecord,
  requestedBranchId?: string
): Promise<BranchAccess> => {
  const branchId = requestedBranchId ?? staff.branchId ?? undefined;

  if (!branchId) {
    return { branchId: undefined };
  }

  if (staff.branchId && requestedBranchId && requestedBranchId !== staff.branchId) {
    return { status: 400, message: "branchId does not match the staff branch" };
  }

  if (
    isBranchManagedRole(req.user?.role) &&
    req.user?.branchId &&
    branchId !== req.user.branchId
  ) {
    return { status: 403, message: "You do not have access to this branch" };
  }

  const branch = await LeaveModel.findBranchById(branchId);

  if (!branch || branch.salonId !== staff.salonId) {
    return { status: 400, message: "Branch does not belong to the staff salon" };
  }

  return { branchId };
};

const resolveLeaveAccess = async (req: Request, id: string): Promise<LeaveAccess> => {
  if (!req.user) {
    return { status: 401, message: "Unauthorized" };
  }

  const leave = await LeaveModel.findById(id);

  if (!leave) {
    return { status: 404, message: "Leave not found" };
  }

  if (req.user.role === "SUPER_ADMIN") {
    return { leave };
  }

  if (!req.user.salonId) {
    return { status: 400, message: "Salon ID is missing" };
  }

  if (leave.salonId !== req.user.salonId) {
    return { status: 403, message: "You do not have access to this leave" };
  }

  if (isSelfServiceRole(req.user.role)) {
    const staff = await LeaveModel.findStaffByUserId(req.user.userId);

    if (!staff || staff.id !== leave.staffId) {
      return { status: 403, message: "You can only access your own leave" };
    }
  }

  if (
    req.user.role === "BRANCH_MANAGER" &&
    req.user.branchId &&
    leave.branchId !== req.user.branchId
  ) {
    return { status: 403, message: "You do not have access to this branch" };
  }

  return { leave };
};

const sendError = (res: Response, error: AccessError) =>
  res.status(error.status).json({ success: false, message: error.message });

export const createLeave = async (req: Request, res: Response) => {
  try {
    if (!isLeaveType(req.body.leaveType)) {
      return res.status(400).json({ success: false, message: "Invalid leaveType" });
    }

    const startDate = parseDate(req.body.startDate);
    const endDate = parseDate(req.body.endDate);

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "startDate and endDate are required in YYYY-MM-DD format",
      });
    }

    if (endDate < startDate) {
      return res.status(400).json({
        success: false,
        message: "endDate cannot be earlier than startDate",
      });
    }

    const access = await resolveTargetStaff(
      req,
      getString(req.body.staffId),
      getString(req.body.salonId)
    );

    if (!("staff" in access)) {
      return sendError(res, access);
    }

    const branch = await resolveBranch(req, access.staff, getString(req.body.branchId));

    if ("status" in branch) {
      return sendError(res, branch);
    }

    const calculatedDays =
      Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
    const suppliedDays =
      req.body.totalDays === undefined ? undefined : Number(req.body.totalDays);

    if (
      suppliedDays !== undefined &&
      (!Number.isInteger(suppliedDays) || suppliedDays <= 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "totalDays must be a positive integer",
      });
    }

    const overlap = await LeaveModel.findOverlap({
      staffId: access.staff.id,
      startDate,
      endDate,
    });

    if (overlap) {
      return res.status(409).json({
        success: false,
        message: "Leave overlaps an existing pending or approved leave",
      });
    }

    const reason = getString(req.body.reason);
    const leave = await LeaveModel.create({
      salonId: access.staff.salonId,
      staffId: access.staff.id,
      leaveType: req.body.leaveType,
      startDate,
      endDate,
      totalDays: suppliedDays ?? calculatedDays,
      ...(branch.branchId ? { branchId: branch.branchId } : {}),
      ...(reason ? { reason } : {}),
    });

    return res.status(201).json({
      success: true,
      message: "Leave requested successfully",
      data: leave,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const getLeaves = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const statusValue = getString(req.query.status);
    const leaveTypeValue = getString(req.query.leaveType);

    if (statusValue && !isLeaveStatus(statusValue)) {
      return res.status(400).json({ success: false, message: "Invalid leave status" });
    }

    if (leaveTypeValue && !isLeaveType(leaveTypeValue)) {
      return res.status(400).json({ success: false, message: "Invalid leaveType" });
    }

    const fromValue = getString(req.query.from);
    const toValue = getString(req.query.to);
    const from = fromValue ? parseDate(fromValue) : undefined;
    const to = toValue ? parseDate(toValue) : undefined;

    if ((fromValue && !from) || (toValue && !to)) {
      return res.status(400).json({
        success: false,
        message: "from and to must use YYYY-MM-DD",
      });
    }

    if (from && to && from > to) {
      return res.status(400).json({ success: false, message: "from cannot be later than to" });
    }

    let staffId = getString(req.query.staffId);
    let salonId = getString(req.query.salonId);
    let branchId = getString(req.query.branchId);

    if (isSelfServiceRole(req.user.role)) {
      const access = await resolveTargetStaff(req, staffId);

      if (!("staff" in access)) {
        return sendError(res, access);
      }

      staffId = access.staff.id;
      salonId = access.staff.salonId;
      branchId = access.staff.branchId ?? undefined;
    } else if (staffId) {
      const access = await resolveTargetStaff(req, staffId, salonId);

      if (!("staff" in access)) {
        return sendError(res, access);
      }
    }

    if (req.user.role !== "SUPER_ADMIN") {
      if (!req.user.salonId) {
        return res.status(400).json({ success: false, message: "Salon ID is missing" });
      }

      if (salonId && salonId !== req.user.salonId) {
        return res.status(403).json({
          success: false,
          message: "You do not have access to this salon",
        });
      }

      salonId = req.user.salonId;
    }

    if (req.user.role === "BRANCH_MANAGER" && req.user.branchId) {
      if (branchId && branchId !== req.user.branchId) {
        return res.status(403).json({
          success: false,
          message: "You do not have access to this branch",
        });
      }

      branchId = req.user.branchId;
    }

    branchId = applyBranchSession(req, branchId);

    if (branchId) {
      const branch = await LeaveModel.findBranchById(branchId);

      if (!branch || (salonId && branch.salonId !== salonId)) {
        return res.status(400).json({
          success: false,
          message: "Branch does not belong to the selected salon",
        });
      }
    }

    const status: LeaveStatus | undefined =
      statusValue && isLeaveStatus(statusValue) ? statusValue : undefined;
    const leaveType: LeaveType | undefined =
      leaveTypeValue && isLeaveType(leaveTypeValue) ? leaveTypeValue : undefined;

    const leaves = await LeaveModel.findMany({
      ...(salonId ? { salonId } : {}),
      ...(branchId ? { branchId } : {}),
      ...(staffId ? { staffId } : {}),
      ...(status ? { status } : {}),
      ...(leaveType ? { leaveType } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });

    return res.status(200).json({
      success: true,
      message: "Leaves fetched successfully",
      data: leaves,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const getLeaveById = async (req: Request, res: Response) => {
  try {
    const id = getIdParam(req);

    if (!id) {
      return res.status(400).json({ success: false, message: "Leave ID is required" });
    }

    const access = await resolveLeaveAccess(req, id);

    if (!("leave" in access)) {
      return sendError(res, access);
    }

    return res.status(200).json({
      success: true,
      message: "Leave fetched successfully",
      data: access.leave,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const approveLeave = async (req: Request, res: Response) => {
  try {
    const id = getIdParam(req);

    if (!id) {
      return res.status(400).json({ success: false, message: "Leave ID is required" });
    }

    const access = await resolveLeaveAccess(req, id);

    if (!("leave" in access)) {
      return sendError(res, access);
    }

    if (access.leave.status !== "PENDING") {
      return res.status(409).json({
        success: false,
        message: "Only pending leave can be approved",
      });
    }

    const leave = await LeaveModel.transitionPending(id, {
      status: "APPROVED",
      approvedById: req.user!.userId,
      approvedAt: new Date(),
    });

    if (!leave) {
      return res.status(409).json({ success: false, message: "Leave is no longer pending" });
    }

    return res.status(200).json({
      success: true,
      message: "Leave approved successfully",
      data: leave,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const rejectLeave = async (req: Request, res: Response) => {
  try {
    const id = getIdParam(req);

    if (!id) {
      return res.status(400).json({ success: false, message: "Leave ID is required" });
    }

    const access = await resolveLeaveAccess(req, id);

    if (!("leave" in access)) {
      return sendError(res, access);
    }

    if (access.leave.status !== "PENDING") {
      return res.status(409).json({
        success: false,
        message: "Only pending leave can be rejected",
      });
    }

    const rejectionReason = getString(req.body.rejectionReason);
    const leave = await LeaveModel.transitionPending(id, {
      status: "REJECTED",
      ...(rejectionReason ? { rejectionReason } : {}),
    });

    if (!leave) {
      return res.status(409).json({ success: false, message: "Leave is no longer pending" });
    }

    return res.status(200).json({
      success: true,
      message: "Leave rejected successfully",
      data: leave,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const cancelLeave = async (req: Request, res: Response) => {
  try {
    const id = getIdParam(req);

    if (!id) {
      return res.status(400).json({ success: false, message: "Leave ID is required" });
    }

    const access = await resolveLeaveAccess(req, id);

    if (!("leave" in access)) {
      return sendError(res, access);
    }

    if (access.leave.status !== "PENDING") {
      return res.status(409).json({
        success: false,
        message: "Only pending leave can be cancelled",
      });
    }

    const leave = await LeaveModel.transitionPending(id, { status: "CANCELLED" });

    if (!leave) {
      return res.status(409).json({ success: false, message: "Leave is no longer pending" });
    }

    return res.status(200).json({
      success: true,
      message: "Leave cancelled successfully",
      data: leave,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
