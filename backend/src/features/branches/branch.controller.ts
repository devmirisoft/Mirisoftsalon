import { type Request, type Response } from "express";
import { BranchModel } from "./branch.model.js";
import {
  isBranchLockedRole,
} from "../../utils/branch-scope.js";

const getBranchIdParam = (req: Request) => {
  const { id } = req.params;
  return typeof id === "string" ? id : null;
};

const getExistingBranchByAccess = async (req: Request, branchId: string) => {
  if (req.user?.role === "SUPER_ADMIN") {
    return BranchModel.findById(branchId);
  }

  const salonId = req.user?.salonId;

  if (!salonId) {
    return null;
  }

  if (
    isBranchLockedRole(req.user?.role) &&
    req.user?.branchId &&
    branchId !== req.user?.branchId
  ) {
    return null;
  }

  return BranchModel.findByIdAndSalon(branchId, salonId);
};

export const createBranch = async (req: Request, res: Response) => {
  try {
    const {
      name,
      salonId,
      addressLine1,
      city,
      state,
      postalCode,
      phone,
    } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Branch name is required",
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

    const branch = await BranchModel.create({
      name,
      salonId: finalSalonId,
      addressLine1,
      city,
      state,
      postalCode,
      phone,
    });

    return res.status(201).json({
      success: true,
      message: "Branch created successfully",
      data: branch,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const getBranches = async (req: Request, res: Response) => {
  try {
    if (req.user?.role === "SUPER_ADMIN") {
      const branches = await BranchModel.findAll();

      return res.status(200).json({
        success: true,
        message: "Branches fetched successfully",
        data: branches,
      });
    }

    if (!req.user?.salonId) {
      return res.status(400).json({
        success: false,
        message: "Salon ID is missing",
      });
    }

    if (isBranchLockedRole(req.user.role) && req.user.branchId) {
      const branch = await BranchModel.findByIdAndSalon(
        req.user.branchId,
        req.user.salonId
      );

      return res.status(200).json({
        success: true,
        message: "Branches fetched successfully",
        data: branch ? [branch] : [],
      });
    }

    const branches = await BranchModel.findBySalon(req.user.salonId);

    return res.status(200).json({
      success: true,
      message: "Branches fetched successfully",
      data: branches,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const getBranchById = async (req: Request, res: Response) => {
  try {
    const id = getBranchIdParam(req);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Branch ID is required",
      });
    }

    const branch = await getExistingBranchByAccess(req, id);

    if (!branch) {
      return res.status(404).json({
        success: false,
        message: "Branch not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Branch fetched successfully",
      data: branch,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const updateBranch = async (req: Request, res: Response) => {
  try {
    const id = getBranchIdParam(req);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Branch ID is required",
      });
    }

    const existingBranch = await getExistingBranchByAccess(req, id);

    if (!existingBranch) {
      return res.status(404).json({
        success: false,
        message: "Branch not found",
      });
    }

    const { name, addressLine1, city, state, postalCode, phone } = req.body;

    if ("name" in req.body && !name) {
      return res.status(400).json({
        success: false,
        message: "Branch name is required",
      });
    }

    const branch = await BranchModel.update(id, {
      ...(name ? { name } : {}),
      ...("addressLine1" in req.body
        ? { addressLine1: addressLine1 ?? null }
        : {}),
      ...("city" in req.body ? { city: city ?? null } : {}),
      ...("state" in req.body ? { state: state ?? null } : {}),
      ...("postalCode" in req.body
        ? { postalCode: postalCode ?? null }
        : {}),
      ...("phone" in req.body ? { phone: phone ?? null } : {}),
    });

    return res.status(200).json({
      success: true,
      message: "Branch updated successfully",
      data: branch,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const deleteBranch = async (req: Request, res: Response) => {
  try {
    const id = getBranchIdParam(req);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Branch ID is required",
      });
    }

    const existingBranch = await getExistingBranchByAccess(req, id);

    if (!existingBranch) {
      return res.status(404).json({
        success: false,
        message: "Branch not found",
      });
    }

    await BranchModel.delete(id);

    return res.status(200).json({
      success: true,
      message: "Branch deleted successfully",
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2003"
    ) {
      return res.status(409).json({
        success: false,
        message: "Branch is already used and cannot be deleted",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
