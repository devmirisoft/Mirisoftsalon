import { type Request, type Response } from "express";
import {
  cleanText,
  exactBranchScope,
  getSalonId,
  sendInventoryError,
} from "../products/inventory-access.js";
import { VendorModel, vendorStats } from "./vendor.model.js";

const idParam = (req: Request) =>
  typeof req.params.id === "string" ? req.params.id : "";

const accessWhere = (req: Request, id?: string) => ({
  ...(id ? { id } : {}),
  ...(req.user?.role === "SUPER_ADMIN"
    ? typeof req.query.salonId === "string"
      ? { salonId: req.query.salonId }
      : {}
    : { salonId: req.user?.salonId || "__missing__" }),
});

const optionalFields = (body: Record<string, unknown>) => {
  const contactPerson = cleanText(body.contactPerson);
  const email = cleanText(body.email);
  const phone = cleanText(body.phone);
  const address = cleanText(body.address);
  const gst = cleanText(body.gst);
  const paymentTerms = cleanText(body.paymentTerms);
  return {
    ...(contactPerson ? { contactPerson } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    ...(address ? { address } : {}),
    ...(gst ? { gst } : {}),
    ...(paymentTerms ? { paymentTerms } : {}),
  };
};

export const createVendor = async (req: Request, res: Response) => {
  try {
    const salonId = getSalonId(req, req.body.salonId);
    const name = cleanText(req.body.name);
    if (!salonId || !name) {
      return res.status(400).json({
        success: false,
        message: "Vendor name and salon are required",
      });
    }
    if (await VendorModel.duplicate(salonId, name)) {
      return res
        .status(409)
        .json({ success: false, message: "Vendor already exists" });
    }
    const data = await VendorModel.create({
      salon: { connect: { id: salonId } },
      name,
      ...optionalFields(req.body),
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

export const getVendors = async (req: Request, res: Response) => {
  try {
    const vendors = await VendorModel.list({
      ...accessWhere(req),
      ...(req.query.status === "true" || req.query.status === "false"
        ? { status: req.query.status === "true" }
        : {}),
    });
    const stats = await vendorStats(vendors.map((v) => v.id), exactBranchScope(req));
    const data = vendors.map((v) => ({ ...v, ...stats.get(v.id) }));
    return res.json({ success: true, data });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

export const getVendor = async (req: Request, res: Response) => {
  try {
    const vendor = await VendorModel.find(accessWhere(req, idParam(req)));
    if (!vendor) {
      return res
        .status(404)
        .json({ success: false, message: "Vendor not found" });
    }
    const stats = await vendorStats([vendor.id], exactBranchScope(req));
    return res.json({ success: true, data: { ...vendor, ...stats.get(vendor.id) } });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

export const updateVendor = async (req: Request, res: Response) => {
  try {
    const existing = await VendorModel.find(accessWhere(req, idParam(req)));
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Vendor not found" });
    }
    const name =
      req.body.name === undefined ? undefined : cleanText(req.body.name);
    if (req.body.name !== undefined && !name) {
      return res
        .status(400)
        .json({ success: false, message: "Vendor name is required" });
    }
    if (
      name &&
      (await VendorModel.duplicate(existing.salonId, name, existing.id))
    ) {
      return res
        .status(409)
        .json({ success: false, message: "Vendor already exists" });
    }
    const nullable = [
      "contactPerson",
      "email",
      "phone",
      "address",
      "gst",
      "paymentTerms",
    ] as const;
    const data = await VendorModel.update(existing.id, {
      ...(name ? { name } : {}),
      ...Object.fromEntries(
        nullable
          .filter((key) => key in req.body)
          .map((key) => [key, cleanText(req.body[key]) ?? null])
      ),
    });
    return res.json({ success: true, data });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

export const setVendorStatus = async (req: Request, res: Response) => {
  try {
    if (typeof req.body.status !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Status must be true or false",
      });
    }
    const existing = await VendorModel.find(accessWhere(req, idParam(req)));
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Vendor not found" });
    }
    const data = await VendorModel.update(existing.id, {
      status: req.body.status,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

export const deleteVendor = async (req: Request, res: Response) => {
  try {
    const existing = await VendorModel.find(accessWhere(req, idParam(req)));
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Vendor not found" });
    }
    const count = Object.values(existing._count).reduce(
      (sum, value) => sum + value,
      0
    );
    if (count > 0) {
      return res.status(409).json({
        success: false,
        message: "Cannot delete a vendor with related inventory or payments",
      });
    }
    await VendorModel.remove(existing.id);
    return res.json({ success: true, message: "Vendor deleted" });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};
