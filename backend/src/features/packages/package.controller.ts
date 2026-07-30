import { type Request, type Response } from "express";
import { z } from "zod";
import { requestAuditContext } from "../audit-logs/audit-log.service.js";
import {
  copyCustomerCustomPackage,
  createPackageCategory,
  createCustomPackageFromCart,
  createServicePackage,
  deletePackageCategory,
  deleteServicePackage,
  getCustomerPackage,
  getCustomerPackageBalances,
  getCustomerPackageBalancesForCustomer,
  getCustomerPackageUsages,
  getPackageCategory,
  getServicePackage,
  listCustomerPackages,
  listCustomerCustomPackages,
  listPackageCategories,
  listServicePackages,
  PackageError,
  setCustomerPackageStatus,
  setPackageCategoryStatus,
  setServicePackageStatus,
  updatePackageCategory,
  updateServicePackage,
  type PackageActor,
} from "./package.service.js";
import {
  categoryInputSchema,
  copyCustomerCustomPackageSchema,
  createCustomPackageFromCartSchema,
  customerCustomPackageListSchema,
  customerPackageStatusSchema,
  packageListSchema,
  packageStatusSchema,
  servicePackageInputSchema,
  updateServicePackageInputSchema,
} from "./package.validation.js";

const actorFrom = (req: Request): PackageActor => {
  if (!req.user?.userId) throw new PackageError(401, "Unauthorized");
  return {
    userId: req.user.userId,
    role: req.user.role,
    ...(req.user.salonId ? { salonId: req.user.salonId } : {}),
    ...(req.user.branchId ? { branchId: req.user.branchId } : {}),
  };
};

const idFrom = (req: Request, key = "id") => {
  const value = req.params[key];
  return typeof value === "string" ? value : "";
};

const sendError = (res: Response, error: unknown) => {
  if (error instanceof PackageError) {
    return res
      .status(error.status)
      .json({ success: false, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      success: false,
      message: error.issues[0]?.message ?? "Invalid package request",
      errors: error.issues,
    });
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  ) {
    return res.status(409).json({
      success: false,
      message: "Package name already exists in this salon",
    });
  }
  console.error(error);
  return res.status(500).json({
    success: false,
    message: "Unable to process package request",
  });
};

const listFilters = (req: Request) => packageListSchema.parse(req.query);

export const getPackageCategories = async (req: Request, res: Response) => {
  try {
    return res.json({
      success: true,
      ...(await listPackageCategories(actorFrom(req), listFilters(req))),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getPackageCategoryById = async (
  req: Request,
  res: Response
) => {
  try {
    return res.json({
      success: true,
      data: await getPackageCategory(actorFrom(req), idFrom(req)),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const postPackageCategory = async (req: Request, res: Response) => {
  try {
    const input = categoryInputSchema.parse(req.body);
    const data = await createPackageCategory(
      actorFrom(req),
      input,
      requestAuditContext(req)
    );
    return res.status(201).json({
      success: true,
      message: "Package category created successfully",
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const putPackageCategory = async (req: Request, res: Response) => {
  try {
    const input = categoryInputSchema.omit({ salonId: true }).parse(req.body);
    const data = await updatePackageCategory(
      actorFrom(req),
      idFrom(req),
      input,
      requestAuditContext(req)
    );
    return res.json({
      success: true,
      message: "Package category updated successfully",
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const patchPackageCategoryStatus = async (
  req: Request,
  res: Response
) => {
  try {
    const { status } = packageStatusSchema.parse(req.body);
    const data = await setPackageCategoryStatus(
      actorFrom(req),
      idFrom(req),
      status,
      requestAuditContext(req)
    );
    return res.json({ success: true, message: "Status updated", data });
  } catch (error) {
    return sendError(res, error);
  }
};

export const removePackageCategory = async (
  req: Request,
  res: Response
) => {
  try {
    const result = await deletePackageCategory(
      actorFrom(req),
      idFrom(req),
      requestAuditContext(req)
    );
    return res.json({
      success: true,
      message: result.softDeleted
        ? "Package category deactivated because packages are linked"
        : "Package category deleted successfully",
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getPackages = async (req: Request, res: Response) => {
  try {
    return res.json({
      success: true,
      ...(await listServicePackages(actorFrom(req), listFilters(req))),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getCustomerCustomPackages = async (
  req: Request,
  res: Response
) => {
  try {
    const query = customerCustomPackageListSchema.parse(req.query);
    return res.json({
      success: true,
      ...(await listCustomerCustomPackages(actorFrom(req), query)),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getPackageById = async (req: Request, res: Response) => {
  try {
    return res.json({
      success: true,
      data: await getServicePackage(actorFrom(req), idFrom(req)),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const postPackage = async (req: Request, res: Response) => {
  try {
    const input = servicePackageInputSchema.parse(req.body);
    const data = await createServicePackage(
      actorFrom(req),
      input,
      requestAuditContext(req)
    );
    return res.status(201).json({
      success: true,
      message: "Package created successfully",
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const postCustomPackageFromCart = async (
  req: Request,
  res: Response
) => {
  try {
    const input = createCustomPackageFromCartSchema.parse(req.body);
    const data = await createCustomPackageFromCart(
      actorFrom(req),
      input,
      requestAuditContext(req)
    );
    return res.status(201).json({
      success: true,
      message: "Custom package created from job cart",
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const postCopyCustomerCustomPackage = async (
  req: Request,
  res: Response
) => {
  try {
    const input = copyCustomerCustomPackageSchema.parse(req.body);
    const data = await copyCustomerCustomPackage(
      actorFrom(req),
      input,
      requestAuditContext(req)
    );
    return res.status(201).json({
      success: true,
      message: "Custom package copied successfully",
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const putPackage = async (req: Request, res: Response) => {
  try {
    const input = updateServicePackageInputSchema.parse(req.body);
    const data = await updateServicePackage(
      actorFrom(req),
      idFrom(req),
      input,
      requestAuditContext(req)
    );
    return res.json({
      success: true,
      message: "Package updated successfully",
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const patchPackageStatus = async (req: Request, res: Response) => {
  try {
    const { status } = packageStatusSchema.parse(req.body);
    const data = await setServicePackageStatus(
      actorFrom(req),
      idFrom(req),
      status,
      requestAuditContext(req)
    );
    return res.json({ success: true, message: "Status updated", data });
  } catch (error) {
    return sendError(res, error);
  }
};

export const removePackage = async (req: Request, res: Response) => {
  try {
    const result = await deleteServicePackage(
      actorFrom(req),
      idFrom(req),
      requestAuditContext(req)
    );
    return res.json({
      success: true,
      message: result.softDeleted
        ? "Package deactivated because sales are linked"
        : "Package deleted successfully",
    });
  } catch (error) {
    return sendError(res, error);
  }
};

const customerPackageQuerySchema = packageListSchema.extend({
  customerId: z.string().uuid().optional(),
  packageId: z.string().uuid().optional(),
  status: z
    .enum(["ACTIVE", "EXPIRED", "USED", "CANCELLED"])
    .optional(),
});

export const getCustomerPackages = async (req: Request, res: Response) => {
  try {
    const query = customerPackageQuerySchema.parse(req.query);
    return res.json({
      success: true,
      ...(await listCustomerPackages(actorFrom(req), query)),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getCustomerPackagesForCustomer = async (
  req: Request,
  res: Response
) => {
  try {
    const query = customerPackageQuerySchema.parse(req.query);
    return res.json({
      success: true,
      ...(await listCustomerPackages(actorFrom(req), {
        ...query,
        customerId: idFrom(req, "customerId"),
      })),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getCustomerPackageById = async (
  req: Request,
  res: Response
) => {
  try {
    return res.json({
      success: true,
      data: await getCustomerPackage(actorFrom(req), idFrom(req)),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const patchCustomerPackageStatus = async (
  req: Request,
  res: Response
) => {
  try {
    const { status } = customerPackageStatusSchema.parse(req.body);
    const data = await setCustomerPackageStatus(
      actorFrom(req),
      idFrom(req),
      status,
      requestAuditContext(req)
    );
    return res.json({ success: true, message: "Status updated", data });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getCustomerPackageBalancesById = async (
  req: Request,
  res: Response
) => {
  try {
    return res.json({
      success: true,
      data: await getCustomerPackageBalances(actorFrom(req), idFrom(req)),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getCustomerPackageUsageHistory = async (
  req: Request,
  res: Response
) => {
  try {
    return res.json({
      success: true,
      data: await getCustomerPackageUsages(actorFrom(req), idFrom(req)),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getCustomerPackageBalancesByCustomer = async (
  req: Request,
  res: Response
) => {
  try {
    return res.json({
      success: true,
      data: await getCustomerPackageBalancesForCustomer(
        actorFrom(req),
        idFrom(req, "customerId")
      ),
    });
  } catch (error) {
    return sendError(res, error);
  }
};
