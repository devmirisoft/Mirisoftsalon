import { type Request, type Response } from "express";
import { prisma } from "../../config/prisma.js";
import { Prisma, type Role } from "../../generated/prisma/client.js";
import { isValidTimezone } from "../../utils/timezone.js";
import {
  createAuditLog,
  requestAuditContext,
} from "../audit-logs/audit-log.service.js";

const GSTIN_PATTERN =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[0-9+\-\s()]{7,20}$/;
const PINCODE_PATTERN = /^[1-9][0-9]{5}$/;
const TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

const salonEditors = new Set<Role | string>(["SUPER_ADMIN", "SALON_ADMIN"]);
const branchEditors = new Set<Role | string>([
  "SUPER_ADMIN",
  "SALON_ADMIN",
  "BRANCH_MANAGER",
]);

const trimString = (value: unknown) =>
  typeof value === "string" ? value.trim() : value;

const optionalString = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

const requiredString = (value: unknown, field: string) => {
  const trimmed = optionalString(value);
  if (!trimmed) return { error: `${field} is required` };
  return { value: trimmed };
};

const validateEmail = (value: string | null, field = "email") =>
  value && !EMAIL_PATTERN.test(value) ? `${field} is invalid` : null;

const validatePhone = (value: string | null, field = "phone") =>
  value && !PHONE_PATTERN.test(value) ? `${field} is invalid` : null;

const validatePincode = (value: string | null, field = "pincode") =>
  value && !PINCODE_PATTERN.test(value) ? `${field} is invalid` : null;

const validateTime = (value: string | null, field: string) =>
  value && !TIME_PATTERN.test(value) ? `${field} must use HH:mm format` : null;

const parseRate = (value: unknown, field: string) => {
  try {
    const parsed = new Prisma.Decimal(value as string | number | Prisma.Decimal);
    if (parsed.lt(0) || parsed.gt(100)) {
      return { error: `${field} must be between 0 and 100` };
    }
    return { value: parsed.toDecimalPlaces(2) };
  } catch {
    return { error: `${field} must be a valid number` };
  }
};

const serializeDecimal = (value: unknown) =>
  Prisma.Decimal.isDecimal(value) ? value.toFixed(2) : value;

const safeUserSelect = {
  id: true,
  name: true,
  email: true,
  phone_number: true,
  role: true,
  status: true,
  salonId: true,
  branchId: true,
  createdAt: true,
  updatedAt: true,
  salon: {
    select: {
      id: true,
      name: true,
      salonCode: true,
    },
  },
  branch: {
    select: {
      id: true,
      name: true,
      branchCode: true,
    },
  },
} as const;

const salonProfileSelect = {
  id: true,
  name: true,
  legalName: true,
  salonCode: true,
  email: true,
  phone: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  timezone: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

const branchProfileSelect = {
  id: true,
  name: true,
  branchCode: true,
  salonId: true,
  email: true,
  phone: true,
  addressLine1: true,
  city: true,
  state: true,
  postalCode: true,
  openingTime: true,
  closingTime: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

const gstSelect = {
  id: true,
  name: true,
  gstEnabled: true,
  membershipDiscountOnPackages: true,
  gstNumber: true,
  gstLegalName: true,
  gstStateCode: true,
  serviceGstRate: true,
  productGstRate: true,
  gstVerifiedAt: true,
} as const;

const profileData = (user: Prisma.UserGetPayload<{ select: typeof safeUserSelect }>) => ({
  id: user.id,
  fullName: user.name,
  email: user.email,
  phone: user.phone_number,
  role: user.role,
  status: user.status,
  salonId: user.salonId,
  branchId: user.branchId,
  currentSalon: user.salon,
  currentBranch: user.branch,
  profileImage: null,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const gstData = (salon: Prisma.SalonGetPayload<{ select: typeof gstSelect }>) => ({
  gstEnabled: salon.gstEnabled,
  membershipDiscountOnPackages: salon.membershipDiscountOnPackages,
  gstNumber: salon.gstNumber,
  gstLegalName: salon.gstLegalName,
  gstStateCode: salon.gstStateCode,
  serviceGstRate: serializeDecimal(salon.serviceGstRate),
  productGstRate: serializeDecimal(salon.productGstRate),
  gstVerified: Boolean(salon.gstVerifiedAt),
  gstVerifiedAt: salon.gstVerifiedAt,
});

const currentSalonId = (req: Request) => {
  if (req.user?.role === "SUPER_ADMIN" && typeof req.query.salonId === "string") {
    return req.query.salonId;
  }
  return req.user?.salonId;
};

const currentBranchId = (req: Request) => {
  if (req.user?.role === "SUPER_ADMIN" && typeof req.query.branchId === "string") {
    return req.query.branchId;
  }
  return req.user?.branchId;
};

export const getProfile = async (req: Request, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: safeUserSelect,
  });
  if (!user) return res.status(404).json({ success: false, message: "Profile not found" });
  return res.status(200).json({ success: true, data: profileData(user) });
};

export const updateProfile = async (req: Request, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

  const name = "fullName" in req.body ? requiredString(req.body.fullName, "Full name") : null;
  if (name && "error" in name) {
    return res.status(400).json({ success: false, message: name.error });
  }
  const phone = "phone" in req.body ? optionalString(req.body.phone) : undefined;
  const phoneError = phone !== undefined ? validatePhone(phone) : null;
  if (phoneError) return res.status(400).json({ success: false, message: phoneError });

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: safeUserSelect,
      });
      const saved = await tx.user.update({
        where: { id: userId },
        data: {
          ...(name && "value" in name ? { name: name.value } : {}),
          ...(phone !== undefined ? { phone_number: phone } : {}),
        },
        select: safeUserSelect,
      });
      await createAuditLog({
        tx,
        salonId: saved.salonId,
        branchId: saved.branchId,
        userId,
        module: "SYSTEM",
        action: "UPDATE",
        entityId: userId,
        entityName: saved.name,
        description: "Personal profile updated",
        oldData: profileData(existing),
        newData: profileData(saved),
        ...requestAuditContext(req),
      });
      return saved;
    });
    return res.status(200).json({ success: true, data: profileData(updated) });
  } catch {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const getSalonProfile = async (req: Request, res: Response) => {
  const salonId = currentSalonId(req);
  if (!salonId) return res.status(400).json({ success: false, message: "Salon ID is missing" });
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: salonProfileSelect,
  });
  if (!salon) return res.status(404).json({ success: false, message: "Salon not found" });
  return res.status(200).json({ success: true, data: salon });
};

export const updateSalonProfile = async (req: Request, res: Response) => {
  if (!salonEditors.has(req.user?.role ?? "")) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
  const salonId = currentSalonId(req);
  if (!salonId) return res.status(400).json({ success: false, message: "Salon ID is missing" });

  const name = "name" in req.body ? requiredString(req.body.name, "Salon name") : null;
  if (name && "error" in name) return res.status(400).json({ success: false, message: name.error });

  const data = {
    ...(name && "value" in name ? { name: name.value } : {}),
    ...("legalName" in req.body ? { legalName: optionalString(req.body.legalName) } : {}),
    ...("email" in req.body ? { email: optionalString(req.body.email) } : {}),
    ...("phone" in req.body ? { phone: optionalString(req.body.phone) } : {}),
    ...("addressLine1" in req.body ? { addressLine1: optionalString(req.body.addressLine1) } : {}),
    ...("addressLine2" in req.body ? { addressLine2: optionalString(req.body.addressLine2) } : {}),
    ...("city" in req.body ? { city: optionalString(req.body.city) } : {}),
    ...("state" in req.body ? { state: optionalString(req.body.state) } : {}),
    ...("postalCode" in req.body ? { postalCode: optionalString(req.body.postalCode) } : {}),
    ...("timezone" in req.body ? { timezone: String(trimString(req.body.timezone) || "") } : {}),
    ...("membershipDiscountOnPackages" in req.body
      ? {
          membershipDiscountOnPackages: Boolean(
            req.body.membershipDiscountOnPackages
          ),
        }
      : {}),
  };

  const emailError = validateEmail(data.email ?? null);
  const phoneError = validatePhone(data.phone ?? null);
  const pincodeError = validatePincode(data.postalCode ?? null);
  if (emailError || phoneError || pincodeError) {
    return res.status(400).json({ success: false, message: emailError || phoneError || pincodeError });
  }
  if ("timezone" in data && !isValidTimezone(data.timezone)) {
    return res.status(400).json({ success: false, message: "Invalid timezone" });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.salon.findUniqueOrThrow({
        where: { id: salonId },
        select: salonProfileSelect,
      });
      const saved = await tx.salon.update({
        where: { id: salonId },
        data,
        select: salonProfileSelect,
      });
      await createAuditLog({
        tx,
        salonId,
        userId: req.user?.userId,
        module: "SYSTEM",
        action: "UPDATE",
        entityId: salonId,
        entityName: saved.name,
        description: "Salon details updated",
        oldData: existing,
        newData: saved,
        ...requestAuditContext(req),
      });
      return saved;
    });
    return res.status(200).json({ success: true, data: updated });
  } catch {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const getBranchProfile = async (req: Request, res: Response) => {
  const branchId = currentBranchId(req);
  const salonId = currentSalonId(req);
  if (!branchId) return res.status(400).json({ success: false, message: "Branch ID is missing" });
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, ...(salonId ? { salonId } : {}) },
    select: branchProfileSelect,
  });
  if (!branch) return res.status(404).json({ success: false, message: "Branch not found" });
  return res.status(200).json({ success: true, data: branch });
};

export const updateBranchProfile = async (req: Request, res: Response) => {
  if (!branchEditors.has(req.user?.role ?? "")) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
  const branchId = currentBranchId(req);
  const salonId = currentSalonId(req);
  if (!branchId || !salonId) {
    return res.status(400).json({ success: false, message: "Branch scope is missing" });
  }

  const name = "name" in req.body ? requiredString(req.body.name, "Branch name") : null;
  if (name && "error" in name) return res.status(400).json({ success: false, message: name.error });

  const data = {
    ...(name && "value" in name ? { name: name.value } : {}),
    ...("branchCode" in req.body ? { branchCode: optionalString(req.body.branchCode) } : {}),
    ...("email" in req.body ? { email: optionalString(req.body.email) } : {}),
    ...("phone" in req.body ? { phone: optionalString(req.body.phone) } : {}),
    ...("addressLine1" in req.body ? { addressLine1: optionalString(req.body.addressLine1) } : {}),
    ...("city" in req.body ? { city: optionalString(req.body.city) } : {}),
    ...("state" in req.body ? { state: optionalString(req.body.state) } : {}),
    ...("postalCode" in req.body ? { postalCode: optionalString(req.body.postalCode) } : {}),
    ...("openingTime" in req.body ? { openingTime: optionalString(req.body.openingTime) } : {}),
    ...("closingTime" in req.body ? { closingTime: optionalString(req.body.closingTime) } : {}),
  };

  const emailError = validateEmail(data.email ?? null);
  const phoneError = validatePhone(data.phone ?? null);
  const pincodeError = validatePincode(data.postalCode ?? null);
  const openingError = validateTime(data.openingTime ?? null, "Opening time");
  const closingError = validateTime(data.closingTime ?? null, "Closing time");
  if (emailError || phoneError || pincodeError || openingError || closingError) {
    return res.status(400).json({
      success: false,
      message: emailError || phoneError || pincodeError || openingError || closingError,
    });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.branch.findFirst({
        where: { id: branchId, salonId },
        select: branchProfileSelect,
      });
      if (!existing) throw new Error("BRANCH_NOT_FOUND");
      const saved = await tx.branch.update({
        where: { id: branchId },
        data,
        select: branchProfileSelect,
      });
      await createAuditLog({
        tx,
        salonId,
        branchId,
        userId: req.user?.userId,
        module: "SYSTEM",
        action: "UPDATE",
        entityId: branchId,
        entityName: saved.name,
        description: "Branch details updated",
        oldData: existing,
        newData: saved,
        ...requestAuditContext(req),
      });
      return saved;
    });
    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    if (error instanceof Error && error.message === "BRANCH_NOT_FOUND") {
      return res.status(404).json({ success: false, message: "Branch not found" });
    }
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const getGstProfile = async (req: Request, res: Response) => {
  const salonId = currentSalonId(req);
  if (!salonId) return res.status(400).json({ success: false, message: "Salon ID is missing" });
  const salon = await prisma.salon.findUnique({ where: { id: salonId }, select: gstSelect });
  if (!salon) return res.status(404).json({ success: false, message: "Salon not found" });
  return res.status(200).json({ success: true, data: gstData(salon) });
};

export const updateGstProfile = async (req: Request, res: Response) => {
  if (!salonEditors.has(req.user?.role ?? "")) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
  const salonId = currentSalonId(req);
  if (!salonId) return res.status(400).json({ success: false, message: "Salon ID is missing" });

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.salon.findUniqueOrThrow({
        where: { id: salonId },
        select: gstSelect,
      });
      const gstEnabled =
        "gstEnabled" in req.body ? Boolean(req.body.gstEnabled) : existing.gstEnabled;
      const gstNumber =
        "gstNumber" in req.body ? optionalString(req.body.gstNumber)?.toUpperCase() ?? null : existing.gstNumber;
      const gstLegalName =
        "gstLegalName" in req.body ? optionalString(req.body.gstLegalName) : existing.gstLegalName;
      const gstStateCode =
        "gstStateCode" in req.body ? optionalString(req.body.gstStateCode) : existing.gstStateCode;
      if (gstEnabled && !gstNumber) {
        throw new Error("GST number is required when GST is enabled");
      }
      if (gstNumber && !GSTIN_PATTERN.test(gstNumber)) {
        throw new Error("Invalid GST number format");
      }
      const serviceRate =
        "serviceGstRate" in req.body
          ? parseRate(req.body.serviceGstRate, "Service GST rate")
          : { value: existing.serviceGstRate };
      const productRate =
        "productGstRate" in req.body
          ? parseRate(req.body.productGstRate, "Product GST rate")
          : { value: existing.productGstRate };
      if ("error" in serviceRate) throw new Error(serviceRate.error);
      if ("error" in productRate) throw new Error(productRate.error);

      const saved = await tx.salon.update({
        where: { id: salonId },
        data: {
          gstEnabled,
          gstNumber,
          gstLegalName,
          gstStateCode,
          serviceGstRate: serviceRate.value,
          productGstRate: productRate.value,
          gstVerifiedAt: null,
        },
        select: gstSelect,
      });
      await createAuditLog({
        tx,
        salonId,
        userId: req.user?.userId,
        module: "GST",
        action: "UPDATE",
        entityId: salonId,
        entityName: saved.name,
        description: "GST settings updated",
        oldData: gstData(existing),
        newData: gstData(saved),
        ...requestAuditContext(req),
      });
      return saved;
    });
    return res.status(200).json({ success: true, data: gstData(updated) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("GST") || message.includes("rate") ? 400 : 500;
    return res.status(status).json({ success: false, message });
  }
};
