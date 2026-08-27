import { type Request, type Response } from "express";
import { z } from "zod";
import { requestAuditContext } from "../audit-logs/audit-log.service.js";
import {
  addJobCartItem,
  addJobCartPackageRedemption,
  cancelJobCart,
  confirmJobCart,
  createJobCart,
  getJobCart,
  getJobCartReferences,
  getJobCartPackageRedemptions,
  getJobCartCustomerSummary,
  JobCartError,
  listJobCarts,
  removeJobCartItem,
  removeJobCartPackageRedemption,
  updateJobCart,
  type JobCartActor,
} from "./job-cart.service.js";
import {
  addJobCartItemSchema,
  addPackageRedemptionSchema,
  customerSummarySchema,
  createJobCartSchema,
  listJobCartsSchema,
  updateJobCartSchema,
} from "./job-cart.validation.js";

const actorFrom = (req: Request): JobCartActor => {
  if (!req.user?.userId) throw new JobCartError(401, "Unauthorized");
  return {
    userId: req.user.userId,
    role: req.user.role,
    ...(req.user.salonId ? { salonId: req.user.salonId } : {}),
    ...(req.user.branchId ? { branchId: req.user.branchId } : {}),
  };
};

const param = (req: Request, name: string) => {
  const value = req.params[name];
  return typeof value === "string" ? value : "";
};

const sendError = (res: Response, error: unknown) => {
  if (error instanceof JobCartError) {
    return res
      .status(error.status)
      .json({ success: false, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      success: false,
      message: error.issues[0]?.message ?? "Invalid job cart request",
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
      message: "A customer with this phone number already exists",
    });
  }
  console.error(error);
  return res.status(500).json({
    success: false,
    message: "Unable to process job cart",
  });
};

export const getJobCarts = async (req: Request, res: Response) => {
  try {
    const parsed = listJobCartsSchema.parse(req.query);
    const result = await listJobCarts(actorFrom(req), {
      page: parsed.page,
      limit: parsed.limit,
      ...(parsed.salonId ? { salonId: parsed.salonId } : {}),
      ...(parsed.branchId ? { branchId: parsed.branchId } : {}),
      ...(parsed.customerId ? { customerId: parsed.customerId } : {}),
      ...(parsed.search ? { search: parsed.search } : {}),
      ...(parsed.customerName
        ? { customerName: parsed.customerName }
        : {}),
      ...(parsed.phone ? { phone: parsed.phone } : {}),
      ...(parsed.status ? { status: parsed.status } : {}),
      ...(parsed.createdById ? { createdById: parsed.createdById } : {}),
      ...(parsed.startDate
        ? { startDate: new Date(`${parsed.startDate}T00:00:00.000Z`) }
        : {}),
      ...(parsed.endDate
        ? { endDate: new Date(`${parsed.endDate}T23:59:59.999Z`) }
        : {}),
    });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getJobCartReferenceData = async (
  req: Request,
  res: Response
) => {
  try {
    const query = z
      .object({
        salonId: z.string().uuid().optional(),
        branchId: z.string().uuid().optional(),
      })
      .parse(req.query);
    const data = await getJobCartReferences(
      actorFrom(req),
      query.salonId,
      query.branchId
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getJobCartCustomerSummaryController = async (
  req: Request,
  res: Response
) => {
  try {
    const query = customerSummarySchema.parse(req.query);
    const data = await getJobCartCustomerSummary(actorFrom(req), query);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

export const postJobCart = async (req: Request, res: Response) => {
  try {
    const parsed = createJobCartSchema.parse(req.body);
    const data = await createJobCart(
      actorFrom(req),
      {
        branchId: parsed.branchId,
        customerName: parsed.customerName,
        phone: parsed.phone,
        serviceIds:
          parsed.serviceItems?.map((item) => item.serviceId) ??
          parsed.serviceIds,
        ...(parsed.serviceItems
          ? { serviceItems: parsed.serviceItems }
          : {}),
        startTime: new Date(parsed.startTime),
        ...(parsed.salonId ? { salonId: parsed.salonId } : {}),
        ...(parsed.staffId ? { staffId: parsed.staffId } : {}),
        ...(parsed.bookingNote
          ? { bookingNote: parsed.bookingNote }
          : {}),
        ...(parsed.internalNote
          ? { internalNote: parsed.internalNote }
          : {}),
      },
      requestAuditContext(req)
    );
    return res.status(201).json({
      success: true,
      message: "Job cart created successfully",
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getJobCartById = async (req: Request, res: Response) => {
  try {
    const data = await getJobCart(actorFrom(req), param(req, "id"));
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

export const putJobCart = async (req: Request, res: Response) => {
  try {
    const parsed = updateJobCartSchema.parse(req.body);
    const data = await updateJobCart(
      actorFrom(req),
      param(req, "id"),
      {
        ...(parsed.customerName
          ? { customerName: parsed.customerName }
          : {}),
        ...(parsed.phone ? { phone: parsed.phone } : {}),
        ...(parsed.staffId !== undefined
          ? { staffId: parsed.staffId }
          : {}),
        ...(parsed.bookingNote !== undefined
          ? { bookingNote: parsed.bookingNote }
          : {}),
        ...(parsed.internalNote !== undefined
          ? { internalNote: parsed.internalNote }
          : {}),
        ...(parsed.startTime
          ? { startTime: new Date(parsed.startTime) }
          : {}),
      },
      requestAuditContext(req)
    );
    return res.status(200).json({
      success: true,
      message: "Job cart updated successfully",
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const postJobCartItem = async (req: Request, res: Response) => {
  try {
    const parsed = addJobCartItemSchema.parse(req.body);
    const data = await addJobCartItem(
      actorFrom(req),
      param(req, "id"),
      {
        itemType: parsed.itemType,
        ...(parsed.serviceId ? { serviceId: parsed.serviceId } : {}),
        ...(parsed.packageId ? { packageId: parsed.packageId } : {}),
        ...(parsed.staffId ? { staffId: parsed.staffId } : {}),
      },
      requestAuditContext(req)
    );
    return res.status(200).json({
      success: true,
      message: `${parsed.itemType === "PACKAGE" ? "Package" : "Service"} added to job cart`,
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const deleteJobCartItem = async (req: Request, res: Response) => {
  try {
    const data = await removeJobCartItem(
      actorFrom(req),
      param(req, "id"),
      param(req, "itemId"),
      requestAuditContext(req)
    );
    return res.status(200).json({
      success: true,
      message: "Item removed from job cart",
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const postJobCartPackageRedemption = async (
  req: Request,
  res: Response
) => {
  try {
    const parsed = addPackageRedemptionSchema.parse(req.body);
    const data = await addJobCartPackageRedemption(
      actorFrom(req),
      param(req, "id"),
      parsed,
      requestAuditContext(req)
    );
    return res.status(201).json({
      success: true,
      message: "Package redemption reserved",
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getJobCartPackageRedemptionList = async (
  req: Request,
  res: Response
) => {
  try {
    const data = await getJobCartPackageRedemptions(
      actorFrom(req),
      param(req, "id")
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

export const deleteJobCartPackageRedemption = async (
  req: Request,
  res: Response
) => {
  try {
    const data = await removeJobCartPackageRedemption(
      actorFrom(req),
      param(req, "id"),
      param(req, "usageId"),
      requestAuditContext(req)
    );
    return res.status(200).json({
      success: true,
      message: "Package redemption removed",
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const postConfirmJobCart = async (req: Request, res: Response) => {
  try {
    const parsed = z
      .object({
        invoiceType: z.enum(["GST_INVOICE", "BILL_OF_SUPPLY"]).optional(),
        status: z.enum(["DRAFT", "ISSUED"]).optional(),
        discountAmount: z.coerce.number().min(0).optional(),
        processingFeeAmount: z.coerce.number().min(0).optional(),
        taxPercent: z.coerce.number().min(0).max(100).optional(),
        billingNote: z.string().optional().nullable(),
        footerNote: z.string().optional().nullable(),
      })
      .safeParse(req.body || {});

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: parsed.error.issues[0]?.message || "Invalid billing data",
      });
    }

    const data = await confirmJobCart(
      actorFrom(req),
      param(req, "id"),
      requestAuditContext(req),
      parsed.data
    );
    return res.status(200).json({
      success: true,
      message: "Job cart confirmed successfully",
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const postCancelJobCart = async (req: Request, res: Response) => {
  try {
    const data = await cancelJobCart(
      actorFrom(req),
      param(req, "id"),
      requestAuditContext(req)
    );
    return res.status(200).json({
      success: true,
      message: "Job cart cancelled successfully",
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};
