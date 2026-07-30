import { type Request, type Response } from "express";
import { SalonModel } from "./salon.model.js";
import { isValidTimezone } from "../../utils/timezone.js";
import { prisma } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import {
  createAuditLog,
  requestAuditContext,
} from "../audit-logs/audit-log.service.js";

const GSTIN_PATTERN =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

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

const redactGst = (value: string | null | undefined) =>
  value ? `${value.slice(0, 2)}***********${value.slice(-2)}` : null;

const gstAuditData = (salon: {
  gstEnabled: boolean;
  gstNumber: string | null;
  gstLegalName: string | null;
  gstStateCode: string | null;
  serviceGstRate: unknown;
  productGstRate: unknown;
  gstVerifiedAt: Date | null;
}) => ({
  gstEnabled: salon.gstEnabled,
  gstNumber: redactGst(salon.gstNumber),
  gstLegalName: salon.gstLegalName,
  gstStateCode: salon.gstStateCode,
  serviceGstRate: salon.serviceGstRate,
  productGstRate: salon.productGstRate,
  gstVerifiedAt: salon.gstVerifiedAt,
});

const getTargetSalonId = (req: Request) => {
  if (req.user?.role === "SUPER_ADMIN") {
    return typeof req.params.id === "string" && req.params.id
      ? req.params.id
      : typeof req.query.salonId === "string"
        ? req.query.salonId
        : req.user.salonId;
  }
  return req.user?.salonId;
};

export const createSalon = async (req: Request, res: Response) => {
  try {
    const {
      name,
      email,
      phone,
      addressLine1,
      city,
      state,
      postalCode,
      timezone,
    } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Salon name is required",
      });
    }

    if (timezone && !isValidTimezone(timezone)) {
      return res.status(400).json({ success: false, message: "Invalid salon timezone" });
    }

    const salon = await SalonModel.create({
      name,
      email,
      phone,
      addressLine1,
      city,
      state,
      postalCode,
      ...(timezone ? { timezone } : {}),
    });

    return res.status(201).json({
      success: true,
      message: "Salon created successfully",
      data: salon,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const getSalons = async (req: Request, res: Response) => {
  try {
    const salons = await SalonModel.findAll();

    return res.status(200).json({
      success: true,
      message: "Salons fetched successfully",
      data: salons,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const getSalonGstSettings = async (req: Request, res: Response) => {
  try {
    const salonId = getTargetSalonId(req);
    if (!salonId) {
      return res.status(400).json({ success: false, message: "Salon ID is required" });
    }
    const salon = await SalonModel.findById(salonId);
    if (!salon) {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }
    return res.status(200).json({
      success: true,
      data: gstAuditData(salon),
    });
  } catch {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const updateSalonGstSettings = async (req: Request, res: Response) => {
  try {
    const salonId = getTargetSalonId(req);
    if (!salonId) {
      return res.status(400).json({ success: false, message: "Salon ID is required" });
    }
    const existing = await SalonModel.findById(salonId);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }

    const gstEnabled =
      "gstEnabled" in req.body ? Boolean(req.body.gstEnabled) : existing.gstEnabled;
    const gstNumber =
      "gstNumber" in req.body && req.body.gstNumber !== null
        ? String(req.body.gstNumber).trim().toUpperCase()
        : "gstNumber" in req.body
          ? null
          : existing.gstNumber;
    const gstLegalName =
      "gstLegalName" in req.body && req.body.gstLegalName !== null
        ? String(req.body.gstLegalName).trim()
        : "gstLegalName" in req.body
          ? null
          : existing.gstLegalName;
    const gstStateCode =
      "gstStateCode" in req.body && req.body.gstStateCode !== null
        ? String(req.body.gstStateCode).trim()
        : "gstStateCode" in req.body
          ? null
          : existing.gstStateCode;

    if (gstEnabled && !gstNumber) {
      return res.status(400).json({
        success: false,
        message: "GST number is required when GST is enabled",
      });
    }
    if (gstNumber && !GSTIN_PATTERN.test(gstNumber)) {
      return res.status(400).json({
        success: false,
        message: "Invalid GST number format",
      });
    }

    const serviceGstRate =
      "serviceGstRate" in req.body
        ? parseRate(req.body.serviceGstRate, "serviceGstRate")
        : { value: existing.serviceGstRate };
    const productGstRate =
      "productGstRate" in req.body
        ? parseRate(req.body.productGstRate, "productGstRate")
        : { value: existing.productGstRate };
    if ("error" in serviceGstRate) {
      return res.status(400).json({ success: false, message: serviceGstRate.error });
    }
    if ("error" in productGstRate) {
      return res.status(400).json({ success: false, message: productGstRate.error });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Salon" WHERE "id" = ${salonId} FOR UPDATE`;
      const saved = await SalonModel.updateGstSettings(
        salonId,
        {
          gstEnabled,
          gstNumber,
          gstLegalName,
          gstStateCode,
          serviceGstRate: serviceGstRate.value,
          productGstRate: productGstRate.value,
          gstVerifiedAt: null,
        },
        tx
      );
      await createAuditLog({
        tx,
        salonId,
        userId: req.user?.userId,
        module: "GST",
        action: "UPDATE",
        entityId: salonId,
        entityName: saved.name,
        description: `GST settings updated for ${saved.name}`,
        oldData: gstAuditData(existing),
        newData: gstAuditData(saved),
        ...requestAuditContext(req),
      });
      return saved;
    });

    return res.status(200).json({ success: true, data: gstAuditData(updated) });
  } catch {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
