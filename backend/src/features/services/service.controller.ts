import { type Request, type Response } from "express";
import { ServiceModel } from "./service.model.js";
import { BranchModel } from "../branches/branch.model.js";
import { MainServiceModel } from "../main-services/mainService.model.js";
import { prisma } from "../../config/prisma.js";
import { defaultSalonServices } from "./defaultServices.js";
import {
  branchFilterFor,
  isBranchLockedRole,
  resolveWritableBranchId,
} from "../../utils/branch-scope.js";

const DURATION_UNITS = ["MINUTES", "HOURS"] as const;

type DurationUnit = (typeof DURATION_UNITS)[number];

const isValidDurationUnit = (unit: string): unit is DurationUnit => {
  return DURATION_UNITS.includes(unit as DurationUnit);
};

const getFinalSalonId = (req: Request, bodySalonId?: string) => {
  if (req.user?.role === "SUPER_ADMIN") {
    return bodySalonId;
  }

  return req.user?.salonId;
};

const getServiceIdParam = (req: Request) => {
  const { id } = req.params;
  return typeof id === "string" ? id : null;
};

const getExistingServiceByAccess = async (req: Request, serviceId: string) => {
  if (req.user?.role === "SUPER_ADMIN") {
    return ServiceModel.findById(serviceId);
  }

  const salonId = req.user?.salonId;

  if (!salonId) {
    return null;
  }

  return ServiceModel.findByIdAndSalon(serviceId, salonId);
};

export const createService = async (req: Request, res: Response) => {
  try {
    const {
      name,
      description,
      price,
      durationValue,
      durationUnit,
      salonId,
      branchId,
      mainServiceId,
    } = req.body;

    const normalizedName = typeof name === "string" ? name.trim() : "";
    const normalizedPrice = Number(price);
    const normalizedDuration =
      durationValue === undefined || durationValue === null || durationValue === ""
        ? undefined
        : Number(durationValue);

    if (!normalizedName || price === undefined || !mainServiceId) {
      return res.status(400).json({
        success: false,
        message: "Name, price and mainServiceId are required",
      });
    }

    if (!Number.isFinite(normalizedPrice) || normalizedPrice < 0) {
      return res.status(400).json({
        success: false,
        message: "Price must be a valid non-negative number",
      });
    }

    if (
      normalizedDuration !== undefined &&
      (!Number.isInteger(normalizedDuration) || normalizedDuration <= 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Duration value must be a positive whole number",
      });
    }

    if (durationUnit && !isValidDurationUnit(durationUnit)) {
      return res.status(400).json({
        success: false,
        message: "Invalid duration unit",
      });
    }

    const finalSalonId = getFinalSalonId(req, salonId);

    if (!finalSalonId) {
      return res.status(400).json({
        success: false,
        message: "Salon ID is required",
      });
    }

    // A branch-locked caller creates services in their own branch only.
    const branchResolution = resolveWritableBranchId(req, branchId);

    if (!branchResolution.ok) {
      return res.status(400).json({
        success: false,
        message: branchResolution.message,
      });
    }

    const finalBranchId = branchResolution.branchId;

    const mainService = await MainServiceModel.findByIdAndSalon(
      mainServiceId,
      finalSalonId
    );

    if (!mainService) {
      return res.status(400).json({
        success: false,
        message: "Invalid main service for this salon",
      });
    }

    if (finalBranchId) {
      const branch = await BranchModel.findByIdAndSalon(
        finalBranchId,
        finalSalonId
      );

      if (!branch) {
        return res.status(400).json({
          success: false,
          message: "Invalid branch for this salon",
        });
      }
    }

    const existingService = await ServiceModel.findByNameMainServiceAndSalon(
      normalizedName,
      mainServiceId,
      finalSalonId
    );

    if (existingService) {
      return res.status(400).json({
        success: false,
        message: "Service already exists under this main service",
      });
    }

    const service = await ServiceModel.create({
      name: normalizedName,
      salonId: finalSalonId,
      mainServiceId,
      price: normalizedPrice,
      ...(description ? { description } : {}),
      ...(normalizedDuration !== undefined
        ? { durationValue: normalizedDuration }
        : {}),
      ...(durationUnit ? { durationUnit } : {}),
      ...(finalBranchId ? { branchId: finalBranchId } : {}),
    });

    return res.status(201).json({
      success: true,
      message: "Service created successfully",
      data: service,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const getServices = async (req: Request, res: Response) => {
  try {
    if (req.user?.role === "SUPER_ADMIN") {
      const services = await ServiceModel.findAll();

      return res.status(200).json({
        success: true,
        message: "Services fetched successfully",
        data: services,
      });
    }

    if (!req.user?.salonId) {
      return res.status(400).json({
        success: false,
        message: "Salon ID is missing",
      });
    }

    const services = await ServiceModel.findBySalon(
      req.user.salonId,
      branchFilterFor(req)
    );

    return res.status(200).json({
      success: true,
      message: "Services fetched successfully",
      data: services,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const getServiceById = async (req: Request, res: Response) => {
  try {
    const id = getServiceIdParam(req);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Service ID is required",
      });
    }

    const service =
      isBranchLockedRole(req.user?.role) && req.user?.salonId
        ? await ServiceModel.findByIdAndSalon(
            id,
            req.user?.salonId,
            req.user?.branchId
          )
        : await getExistingServiceByAccess(req, id);

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Service fetched successfully",
      data: service,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const seedDefaultServices = async (req: Request, res: Response) => {
  try {
    const salonId =
      req.user?.role === "SUPER_ADMIN"
        ? typeof req.body.salonId === "string"
          ? req.body.salonId
          : undefined
        : req.user?.salonId;

    if (!salonId) {
      return res.status(400).json({
        success: false,
        message: "Salon ID is required",
      });
    }

    const salon = await prisma.salon.findUnique({
      where: { id: salonId },
      select: { id: true },
    });

    if (!salon) {
      return res.status(404).json({
        success: false,
        message: "Salon not found",
      });
    }

    const result = await prisma.$transaction(async (transaction) => {
      let mainServicesCreated = 0;
      let servicesCreated = 0;
      let skippedExisting = 0;

      for (const group of defaultSalonServices) {
        let mainService = await transaction.mainService.findFirst({
          where: {
            salonId,
            name: group.mainService,
          },
          select: { id: true },
        });

        if (!mainService) {
          mainService = await transaction.mainService.create({
            data: {
              salonId,
              name: group.mainService,
            },
            select: { id: true },
          });
          mainServicesCreated += 1;
        }

        for (const service of group.services) {
          const existingService = await transaction.service.findFirst({
            where: {
              salonId,
              mainServiceId: mainService.id,
              name: service.name,
            },
            select: { id: true },
          });

          if (existingService) {
            skippedExisting += 1;
            continue;
          }

          await transaction.service.create({
            data: {
              salonId,
              mainServiceId: mainService.id,
              name: service.name,
              price: service.price,
              durationValue: service.durationValue,
              durationUnit: service.durationUnit,
            },
          });
          servicesCreated += 1;
        }
      }

      return {
        mainServicesCreated,
        servicesCreated,
        skippedExisting,
      };
    });

    return res.status(200).json({
      success: true,
      message: "Default salon services seeded successfully",
      data: result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Unable to seed default salon services",
    });
  }
};

export const updateService = async (req: Request, res: Response) => {
  try {
    const id = getServiceIdParam(req);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Service ID is required",
      });
    }

    const existingService = await getExistingServiceByAccess(req, id);

    if (!existingService) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
      });
    }

    const {
      name,
      description,
      price,
      durationValue,
      durationUnit,
      status,
      branchId,
      mainServiceId,
    } = req.body;

    const finalSalonId = existingService.salonId;
    const normalizedName =
      typeof name === "string" ? name.trim() : undefined;
    const normalizedPrice = price === undefined ? undefined : Number(price);
    const normalizedDuration =
      durationValue === undefined
        ? undefined
        : durationValue === null || durationValue === ""
          ? null
          : Number(durationValue);

    if (name !== undefined && !normalizedName) {
      return res.status(400).json({
        success: false,
        message: "Service name is required",
      });
    }

    if (
      normalizedPrice !== undefined &&
      (!Number.isFinite(normalizedPrice) || normalizedPrice < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Price must be a valid non-negative number",
      });
    }

    if (
      normalizedDuration !== undefined &&
      normalizedDuration !== null &&
      (!Number.isInteger(normalizedDuration) || normalizedDuration <= 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Duration value must be a positive whole number",
      });
    }

    if (durationUnit && !isValidDurationUnit(durationUnit)) {
      return res.status(400).json({
        success: false,
        message: "Invalid duration unit",
      });
    }

    if (isBranchLockedRole(req.user?.role) && "branchId" in req.body &&
      branchId !== req.user?.branchId) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this branch",
      });
    }

    if (branchId) {
      const branch = await BranchModel.findByIdAndSalon(branchId, finalSalonId);

      if (!branch) {
        return res.status(400).json({
          success: false,
          message: "Invalid branch for this salon",
        });
      }
    }

    if (mainServiceId) {
      const mainService = await MainServiceModel.findByIdAndSalon(
        mainServiceId,
        finalSalonId
      );

      if (!mainService) {
        return res.status(400).json({
          success: false,
          message: "Invalid main service for this salon",
        });
      }
    }

    const finalMainServiceId = mainServiceId || existingService.mainServiceId;
    const finalName = normalizedName || existingService.name;

    if (normalizedName || mainServiceId) {
      const duplicate = await ServiceModel.findByNameMainServiceAndSalon(
        finalName,
        finalMainServiceId,
        finalSalonId
      );

      if (duplicate && duplicate.id !== id) {
        return res.status(400).json({
          success: false,
          message: "Service already exists under this main service",
        });
      }
    }

    const updatedService = await ServiceModel.update(id, {
      ...(normalizedName ? { name: normalizedName } : {}),
      ...("description" in req.body
        ? { description: description ?? null }
        : {}),
      ...(normalizedPrice !== undefined ? { price: normalizedPrice } : {}),
      ...("durationValue" in req.body
        ? {
            durationValue: normalizedDuration ?? null,
          }
        : {}),
      ...(durationUnit ? { durationUnit } : {}),
      ...(typeof status === "boolean" ? { status } : {}),
      ...("branchId" in req.body ? { branchId: branchId ?? null } : {}),
      ...(mainServiceId ? { mainServiceId } : {}),
    });

    return res.status(200).json({
      success: true,
      message: "Service updated successfully",
      data: updatedService,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const updateServiceStatus = async (req: Request, res: Response) => {
  try {
    const id = getServiceIdParam(req);
    const { status } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Service ID is required",
      });
    }

    if (typeof status !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Status must be true or false",
      });
    }

    const existingService = await getExistingServiceByAccess(req, id);

    if (!existingService) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
      });
    }

    const updatedService = await ServiceModel.updateStatus(id, status);

    return res.status(200).json({
      success: true,
      message: "Service status updated successfully",
      data: updatedService,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const deleteService = async (req: Request, res: Response) => {
  try {
    const id = getServiceIdParam(req);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Service ID is required",
      });
    }

    const existingService = await getExistingServiceByAccess(req, id);

    if (!existingService) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
      });
    }

    await ServiceModel.delete(id);

    return res.status(200).json({
      success: true,
      message: "Service deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        "Internal server error. This service may already be used in appointments or invoices.",
    });
  }
};
