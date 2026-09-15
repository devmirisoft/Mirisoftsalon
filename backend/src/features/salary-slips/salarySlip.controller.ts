import { type Request, type Response } from "express";
import { applyBranchSession } from "../../utils/branch-scope.js";
import { SalarySlipModel } from "./salarySlip.model.js";
import { generateSalarySlip as calculateSalarySlip } from "./salarySlip.service.js";
import { validateGenerationInput } from "./salarySlip.validation.js";
import { streamSalarySlipPdf } from "./salarySlip.pdf.js";
import {
  createAuditLog,
  requestAuditContext,
} from "../audit-logs/audit-log.service.js";
import { prisma } from "../../config/prisma.js";

const clean = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const idParam = (req: Request) => clean(req.params.id);
const managerBranch = (role?: string) => role === "BRANCH_MANAGER";

const staffAccess = async (req: Request, staffId: string) => {
  const staff = await SalarySlipModel.findStaff(staffId);
  if (!staff) return { error: [404, "Staff not found"] as const };
  if (req.user?.role !== "SUPER_ADMIN") {
    if (!req.user?.salonId || staff.salonId !== req.user.salonId) {
      return { error: [403, "Staff does not belong to your salon"] as const };
    }
    if (managerBranch(req.user.role) && req.user.branchId && staff.branchId !== req.user.branchId) {
      return { error: [403, "Staff does not belong to your branch"] as const };
    }
  }
  return { staff };
};

export const resolveSalarySlipAccess = async (req: Request, id: string) => {
  const slip = await SalarySlipModel.findById(id);
  if (!slip) return { error: [404, "Salary slip not found"] as const };
  if (req.user?.role !== "SUPER_ADMIN") {
    if (!req.user?.salonId || slip.salonId !== req.user.salonId) {
      return { error: [403, "You do not have access to this salary slip"] as const };
    }
    if (managerBranch(req.user.role) && req.user.branchId && slip.branchId !== req.user.branchId) {
      return { error: [403, "You do not have access to this branch"] as const };
    }
    if (req.user.role === "STAFF") {
      const staff = await SalarySlipModel.findStaffByUser(req.user.userId);
      if (!staff || staff.id !== slip.staffId) {
        return { error: [403, "Staff can only access their own salary slips"] as const };
      }
    }
  }
  return { slip };
};

export const generateSalarySlip = async (req: Request, res: Response) => {
  try {
    const validation = validateGenerationInput(req.body);
    if (validation) return res.status(400).json({ success: false, message: validation });
    const staffId = String(req.body.staffId);
    const access = await staffAccess(req, staffId);
    if ("error" in access) return res.status(access.error[0]).json({ success: false, message: access.error[1] });
    const slip = await prisma.$transaction(async (tx) => {
      const generated = await calculateSalarySlip({
      salonId: access.staff.salonId,
      staffId,
      month: Number(req.body.month),
      year: Number(req.body.year),
      bonusAmount: Number(req.body.bonusAmount ?? 0),
      manualDeduction: Number(req.body.manualDeduction ?? 0),
      ...(clean(req.body.note) ? { note: clean(req.body.note)! } : {}),
      }, tx);
      await createAuditLog({
      tx,
      salonId: generated.salonId,
      branchId: generated.branchId,
      userId: req.user?.userId,
      module: "SALARY",
      action: "SALARY_GENERATED",
      entityId: generated.id,
      entityName: access.staff.name,
      description: `Salary slip generated for ${access.staff.name} for ${generated.month}/${generated.year}`,
      newData: {
        month: generated.month,
        year: generated.year,
        grossSalary: generated.grossSalary,
        unpaidLeaveDeduction: generated.unpaidLeaveDeduction,
        latePenalty: generated.latePenalty,
        manualDeduction: generated.manualDeduction,
        netSalary: generated.netSalary,
        status: generated.status,
      },
      ...requestAuditContext(req),
      });
      return generated;
    });
    return res.status(201).json({ success: true, data: slip });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 500;
    return res.status(status).json({ success: false, message: error instanceof Error && status !== 500 ? error.message : "Internal server error" });
  }
};

export const getSalarySlips = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    let salonId = clean(req.query.salonId);
    let branchId = clean(req.query.branchId);
    let staffId = clean(req.query.staffId);
    if (req.user.role === "STAFF") {
      const staff = await SalarySlipModel.findStaffByUser(req.user.userId);
      if (!staff) return res.status(404).json({ success: false, message: "Staff profile not found" });
      salonId = staff.salonId;
      branchId = staff.branchId ?? undefined;
      staffId = staff.id;
    } else if (req.user.role !== "SUPER_ADMIN") {
      if (!req.user.salonId) return res.status(400).json({ success: false, message: "Salon ID is missing" });
      salonId = req.user.salonId;
      if (managerBranch(req.user.role) && req.user.branchId) branchId = req.user.branchId;
    }
    branchId = applyBranchSession(req, branchId);
    const month = req.query.month === undefined ? undefined : Number(req.query.month);
    const year = req.query.year === undefined ? undefined : Number(req.query.year);
    if ((month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12)) || (year !== undefined && !Number.isInteger(year))) {
      return res.status(400).json({ success: false, message: "Invalid month or year" });
    }
    if (staffId) {
      const access = await staffAccess(req, staffId);
      if ("error" in access) return res.status(access.error[0]).json({ success: false, message: access.error[1] });
    }
    const slips = await SalarySlipModel.findMany({
      ...(salonId ? { salonId } : {}),
      ...(branchId ? { branchId } : {}),
      ...(staffId ? { staffId } : {}),
      ...(month ? { month } : {}),
      ...(year ? { year } : {}),
    });
    return res.json({ success: true, data: slips });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const getSalarySlip = async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) return res.status(400).json({ success: false, message: "Salary slip ID is required" });
  const access = await resolveSalarySlipAccess(req, id);
  if ("error" in access) return res.status(access.error[0]).json({ success: false, message: access.error[1] });
  return res.json({ success: true, data: access.slip });
};

export const markSalarySlipPaid = async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) return res.status(400).json({ success: false, message: "Salary slip ID is required" });
  const access = await resolveSalarySlipAccess(req, id);
  if ("error" in access) return res.status(access.error[0]).json({ success: false, message: access.error[1] });
  if (access.slip.status !== "GENERATED") return res.status(409).json({ success: false, message: "Only generated salary slips can be marked paid" });
  const slip = await prisma.$transaction(async (tx) => {
    const updated = await SalarySlipModel.transition(id, ["GENERATED"], {
    status: "PAID",
    paidAt: new Date(),
    ...(req.user?.userId ? { paidById: req.user.userId } : {}),
    }, tx);
    if (!updated) return null;
    await createAuditLog({
    tx,
    salonId: updated.salonId,
    branchId: updated.branchId,
    userId: req.user?.userId,
    module: "SALARY",
    action: "SALARY_PAID",
    entityId: updated.id,
    entityName: access.slip.staff.name,
    description: `Salary slip marked paid for ${access.slip.staff.name}`,
    oldData: { status: access.slip.status },
    newData: { status: updated.status, paidAt: updated.paidAt },
    ...requestAuditContext(req),
    });
    return updated;
  });
  if (!slip) return res.status(409).json({ success: false, message: "Salary slip status changed" });
  return res.json({ success: true, data: slip });
};

export const cancelSalarySlip = async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) return res.status(400).json({ success: false, message: "Salary slip ID is required" });
  const access = await resolveSalarySlipAccess(req, id);
  if ("error" in access) return res.status(access.error[0]).json({ success: false, message: access.error[1] });
  if (access.slip.status === "PAID") return res.status(409).json({ success: false, message: "Paid salary slips cannot be cancelled" });
  const slip = await prisma.$transaction(async (tx) => {
    const updated = await SalarySlipModel.transition(id, ["DRAFT", "GENERATED"], { status: "CANCELLED" }, tx);
    if (!updated) return null;
    await createAuditLog({
    tx,
    salonId: updated.salonId,
    branchId: updated.branchId,
    userId: req.user?.userId,
    module: "SALARY",
    action: "CANCEL",
    entityId: updated.id,
    entityName: access.slip.staff.name,
    description: `Salary slip cancelled for ${access.slip.staff.name}`,
    oldData: { status: access.slip.status },
    newData: { status: updated.status },
    ...requestAuditContext(req),
    });
    return updated;
  });
  if (!slip) return res.status(409).json({ success: false, message: "Only draft or generated slips can be cancelled" });
  return res.json({ success: true, data: slip });
};

export const downloadSalarySlipPdf = async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) return res.status(400).json({ success: false, message: "Salary slip ID is required" });
  const access = await resolveSalarySlipAccess(req, id);
  if ("error" in access) return res.status(access.error[0]).json({ success: false, message: access.error[1] });
  streamSalarySlipPdf(access.slip, res);
};
