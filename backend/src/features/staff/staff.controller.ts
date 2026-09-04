import { type Request, type Response } from "express";
import { StaffModel } from "./staff.model.js";
import {
  createSalaryConfig,
  hasSalaryInput,
  isSameSalary,
  salaryAuditData,
  salaryValues,
  validateSalaryInput,
} from "./staff.salary.js";
import { prisma } from "../../config/prisma.js";
import {
  createAuditLog,
  requestAuditContext,
} from "../audit-logs/audit-log.service.js";
import { BranchModel } from "../branches/branch.model.js";
import { SalonModel } from "../salons/salon.model.js";
import {
  isBranchAccessible,
  isBranchLockedRole,
  resolveBranchScope,
  resolveWritableBranchId,
} from "../../utils/branch-scope.js";

const getSalonInitials = (salonName: string) => {
  const words = salonName
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-zA-Z0-9]/g, ""))
    .filter(Boolean);

  if (words.length === 0) {
    return "SL";
  }

  if (words.length === 1) {
    return words[0]!.slice(0, 2).toUpperCase();
  }

  return words.map((word) => word[0]).join("").toUpperCase();
};

const getIsoWeekday = (date: Date) => {
  const utcDay = date.getUTCDay();
  return utcDay === 0 ? 7 : utcDay;
};

const generateStaffCode = (
  salonName: string,
  joiningDate: Date,
  phone: string
) => {
  const phoneDigits = phone.replace(/\D/g, "");
  const month = String(joiningDate.getUTCMonth() + 1).padStart(2, "0");
  const weekday = getIsoWeekday(joiningDate);
  const phoneSuffix = phoneDigits.slice(-3);

  return `${getSalonInitials(salonName)}-${month}-${weekday}-${phoneSuffix}`;
};

const getStaffIdParam = (req: Request) => {
  const { id } = req.params;
  return typeof id === "string" ? id : null;
};

export const createStaff = async (req: Request, res: Response) => {
  try {
    const {
      name,
      email,
      phone,
      jobRole,
      workingFrom,
      workingTo,
      weekOff,
      joiningDate,
      salonId,
      branchId,
      reportingManagerId,
    } = req.body;

    if (
      !name ||
      !email ||
      !phone ||
      !jobRole ||
      !workingFrom ||
      !workingTo ||
      !weekOff
    ) {
      return res.status(400).json({
        success: false,
        message: "Name, email, phone and work details are required",
      });
    }

    const salaryError = validateSalaryInput(req.body);

    if (salaryError) {
      return res.status(400).json({
        success: false,
        message: salaryError,
      });
    }

    if (
      req.body.baseSalary === undefined ||
      req.body.workingDaysPerMonth === undefined
    ) {
      return res.status(400).json({
        success: false,
        message: "baseSalary and workingDaysPerMonth are required",
      });
    }

    const phoneDigits = String(phone).replace(/\D/g, "");

    if (phoneDigits.length < 3) {
      return res.status(400).json({
        success: false,
        message: "Phone number must contain at least 3 digits",
      });
    }

    let finalSalonId: string | undefined;

    if (req.user?.role === "SUPER_ADMIN") {
      if (!salonId) {
        return res.status(400).json({
          success: false,
          message: "salonId is required for SUPER_ADMIN",
        });
      }

      finalSalonId = salonId;
    } else {
      finalSalonId = req.user?.salonId;
    }

    if (!finalSalonId) {
      return res.status(400).json({
        success: false,
        message: "Salon ID is missing",
      });
    }

    const staffSalonId = finalSalonId;
    const salon = await SalonModel.findById(staffSalonId);

    if (!salon) {
      return res.status(400).json({
        success: false,
        message: "Salon not found",
      });
    }

    const finalJoiningDate = joiningDate ? new Date(joiningDate) : new Date();

    if (Number.isNaN(finalJoiningDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid joiningDate",
      });
    }

    const staffCode = generateStaffCode(
      salon.name,
      finalJoiningDate,
      String(phone)
    );

    const existingStaffCode = await StaffModel.findByStaffCode(
      staffCode,
      staffSalonId
    );

    if (existingStaffCode) {
      return res.status(409).json({
        success: false,
        message: "Staff code already exists",
      });
    }

    const branchResolution = resolveWritableBranchId(req, branchId);

    if (!branchResolution.ok) {
      return res.status(400).json({
        success: false,
        message: branchResolution.message,
      });
    }

    const finalBranchId = branchResolution.branchId;

    if (finalBranchId) {
      const branch = await BranchModel.findByIdandSalon(
        finalBranchId,
        staffSalonId
      );

      if (!branch) {
        return res.status(400).json({
          success: false,
          message: "Invalid branch for this salon",
        });
      }
    }

    const salary = salaryValues(req.body);

    const staff = await prisma.$transaction(async (tx) => {
      const created = await StaffModel.create(
        {
          staffCode,
          name,
          email,
          phone: String(phone),
          jobRole,
          workingFrom,
          workingTo,
          weekOff,
          joiningDate: finalJoiningDate,
          salonId: staffSalonId,
          ...(finalBranchId ? { branchId: finalBranchId } : {}),
          reportingManagerId,
        },
        tx
      );

      const config = await createSalaryConfig(tx, {
        ...salary,
        baseSalary: salary.baseSalary!,
        workingDaysPerMonth: salary.workingDaysPerMonth!,
        effectiveFrom: salary.effectiveFrom ?? finalJoiningDate,
        salonId: staffSalonId,
        staffId: created.id,
        ...(finalBranchId ? { branchId: finalBranchId } : {}),
      });

      await createAuditLog({
        tx,
        salonId: staffSalonId,
        branchId: finalBranchId,
        userId: req.user?.userId,
        module: "SALARY",
        action: "SALARY_CHANGED",
        entityId: config.id,
        entityName: created.name,
        description: `Salary configuration created for ${created.name}`,
        newData: salaryAuditData(config as unknown as Record<string, unknown>),
        ...requestAuditContext(req),
      });

      return { ...created, salaryConfigs: [config] };
    });

    return res.status(201).json({
      success: true,
      message: "Staff created successfully",
      data: staff,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const updateStaffStatus = async (req: Request, res: Response) => {
  try {
    const id = getStaffIdParam(req);
    const { status } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Staff ID is required",
      });
    }

    if (typeof status !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Status must be true or false",
      });
    }

    let existingStaff;

    if (req.user?.role === "SUPER_ADMIN") {
      existingStaff = await StaffModel.findById(id);
    } else {
      if (!req.user?.salonId) {
        return res.status(400).json({
          success: false,
          message: "Salon ID is missing",
        });
      }

      existingStaff = await StaffModel.findByIdAndSalon(id, req.user.salonId);
    }

    if (!existingStaff || !isBranchAccessible(req, existingStaff.branchId)) {
      return res.status(404).json({
        success: false,
        message: "Staff not found",
      });
    }

    const updatedStaff = await StaffModel.updateStatus(id, status);

    return res.status(200).json({
      success: true,
      message: "Staff status updated successfully",
      data: updatedStaff,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const deleteStaff = async (req: Request, res: Response) => {
  try {
    const id = getStaffIdParam(req);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Staff ID is required",
      });
    }

    let existingStaff;

    if (req.user?.role === "SUPER_ADMIN") {
      existingStaff = await StaffModel.findById(id);
    } else {
      if (!req.user?.salonId) {
        return res.status(400).json({
          success: false,
          message: "Salon ID is missing",
        });
      }

      existingStaff = await StaffModel.findByIdAndSalon(id, req.user.salonId);
    }

    if (!existingStaff || !isBranchAccessible(req, existingStaff.branchId)) {
      return res.status(404).json({
        success: false,
        message: "Staff not found",
      });
    }

    await StaffModel.delete(id);

    return res.status(200).json({
      success: true,
      message: "Staff deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const updateStaff = async (req: Request, res: Response) => {
  try {
    const id = getStaffIdParam(req);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Staff ID is required",
      });
    }

    let existingStaff;

    if (req.user?.role === "SUPER_ADMIN") {
      existingStaff = await StaffModel.findById(id);
    } else {
      if (!req.user?.salonId) {
        return res.status(400).json({
          success: false,
          message: "Salon ID is missing",
        });
      }

      existingStaff = await StaffModel.findByIdAndSalon(id, req.user.salonId);
    }

    if (!existingStaff) {
      return res.status(404).json({
        success: false,
        message: "Staff not found",
      });
    }

    if (!isBranchAccessible(req, existingStaff.branchId)) {
      return res.status(404).json({
        success: false,
        message: "Staff not found",
      });
    }

    // Branch-locked callers may never move staff into another branch, so their
    // own branch is reapplied and any branchId in the body is discarded.
    const branchResolution = resolveWritableBranchId(req, req.body.branchId);

    if (!branchResolution.ok) {
      return res.status(400).json({
        success: false,
        message: branchResolution.message,
      });
    }

    if (
      !isBranchLockedRole(req.user?.role) &&
      branchResolution.branchId &&
      req.user?.salonId
    ) {
      const branch = await BranchModel.findByIdandSalon(
        branchResolution.branchId,
        req.user.salonId
      );

      if (!branch) {
        return res.status(400).json({
          success: false,
          message: "Invalid branch for this salon",
        });
      }
    }

    // The edit form resubmits the salary block, so only a real change opens a
    // new effective-dated revision.
    let nextSalary = null;

    if (hasSalaryInput(req.body)) {
      const salaryError = validateSalaryInput(req.body);

      if (salaryError) {
        return res.status(400).json({
          success: false,
          message: salaryError,
        });
      }

      const active = await prisma.staffSalaryConfig.findFirst({
        where: { staffId: id, status: true },
        orderBy: { effectiveFrom: "desc" },
      });
      const values = salaryValues(req.body);

      if (!active || !isSameSalary(active as unknown as Record<string, unknown>, values)) {
        const merged = {
          ...(active
            ? (salaryAuditData(active as unknown as Record<string, unknown>) as ReturnType<
                typeof salaryValues
              >)
            : {}),
          ...values,
        };

        if (
          merged.baseSalary === undefined ||
          merged.workingDaysPerMonth === undefined
        ) {
          return res.status(400).json({
            success: false,
            message: "baseSalary and workingDaysPerMonth are required",
          });
        }

        nextSalary = { merged, previous: active };
      }
    }

    const staffBranchId = branchResolution.branchId ?? existingStaff.branchId;

    const updatedStaff = await prisma.$transaction(async (tx) => {
      const updated = await StaffModel.update(
        id,
        {
          name: req.body.name,
          email: req.body.email,
          phone: req.body.phone,
          jobRole: req.body.jobRole,
          workingFrom: req.body.workingFrom,
          workingTo: req.body.workingTo,
          weekOff: req.body.weekOff,
          ...(branchResolution.branchId
            ? { branchId: branchResolution.branchId }
            : {}),
          reportingManagerId: req.body.reportingManagerId,
        },
        tx
      );

      if (!nextSalary) return updated;

      const config = await createSalaryConfig(tx, {
        ...nextSalary.merged,
        baseSalary: nextSalary.merged.baseSalary!,
        workingDaysPerMonth: nextSalary.merged.workingDaysPerMonth!,
        effectiveFrom: nextSalary.merged.effectiveFrom ?? new Date(),
        salonId: existingStaff.salonId,
        staffId: id,
        ...(staffBranchId ? { branchId: staffBranchId } : {}),
      });

      await createAuditLog({
        tx,
        salonId: existingStaff.salonId,
        branchId: staffBranchId,
        userId: req.user?.userId,
        module: "SALARY",
        action: "SALARY_CHANGED",
        entityId: config.id,
        entityName: updated.name,
        description: `Salary configuration updated for ${updated.name}`,
        ...(nextSalary.previous
          ? {
              oldData: salaryAuditData(
                nextSalary.previous as unknown as Record<string, unknown>
              ),
            }
          : {}),
        newData: salaryAuditData(config as unknown as Record<string, unknown>),
        ...requestAuditContext(req),
      });

      return updated;
    });

    return res.status(200).json({
      success: true,
      message: "Staff updated successfully",
      data: updatedStaff,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const getStaffById = async (req: Request, res: Response) => {
  try {
    const id = getStaffIdParam(req);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Staff ID is required",
      });
    }

    let staff;

    if (req.user?.role === "SUPER_ADMIN") {
      staff = await StaffModel.findById(id);
    } else {
      if (!req.user?.salonId) {
        return res.status(400).json({
          success: false,
          message: "Salon ID is missing",
        });
      }

      staff = await StaffModel.findByIdAndSalon(
        id,
        req.user.salonId,
        resolveBranchScope(req) ?? undefined
      );
    }

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "Staff not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Staff fetched successfully",
      data: staff,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const getStaff = async (req: Request, res: Response) => {
  try {
    if (req.user?.role === "SUPER_ADMIN") {
      const staff = await StaffModel.findAll();

      return res.status(200).json({
        success: true,
        message: "Staff fetched successfully",
        data: staff,
      });
    }

    if (!req.user?.salonId) {
      return res.status(400).json({
        success: false,
        message: "Salon ID is missing",
      });
    }

    const staff = await StaffModel.findBySalon(
      req.user.salonId,
      resolveBranchScope(req) ?? undefined
    );

    return res.status(200).json({
      success: true,
      message: "Staff fetched successfully",
      data: staff,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }

  
};

