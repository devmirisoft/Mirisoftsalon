import { type Request, type Response } from "express";
import { z } from "zod";
import { requestAuditContext } from "../audit-logs/audit-log.service.js";
import {
  createAvailabilityRule,
  createTimeBlock,
  deleteAvailabilityRule,
  deleteTimeBlock,
  getAvailabilityRule,
  getAvailableSlots,
  getStaffRoster,
  getTimeBlock,
  listAvailabilityRules,
  listTimeBlocks,
  parseDateOnly,
  setAvailabilityRuleStatus,
  StaffAvailabilityError,
  type StaffAvailabilityActor,
  updateAvailabilityRule,
  updateTimeBlock,
} from "./staffAvailability.service.js";

const uuid = z.string().uuid();
const status = z.enum(["ACTIVE", "INACTIVE"]);
const blockType = z.enum([
  "BREAK",
  "PERSONAL",
  "TRAINING",
  "MEETING",
  "OFF",
  "OTHER",
]);
const optionalDate = z.string().date().nullable().optional();

const availabilityRuleSchema = z
  .object({
    branchId: uuid,
    staffId: uuid,
    dayOfWeek: z.coerce.number().int().min(0).max(6),
    startTimeMinutes: z.coerce.number().int().min(0).max(1439),
    endTimeMinutes: z.coerce.number().int().min(1).max(1440),
    effectiveFrom: optionalDate,
    effectiveUntil: optionalDate,
    status: status.optional(),
  })
  .superRefine((value, context) => {
    if (value.startTimeMinutes >= value.endTimeMinutes) {
      context.addIssue({
        code: "custom",
        path: ["endTimeMinutes"],
        message: "Availability start must be before end",
      });
    }
    if (
      value.effectiveFrom &&
      value.effectiveUntil &&
      value.effectiveFrom > value.effectiveUntil
    ) {
      context.addIssue({
        code: "custom",
        path: ["effectiveUntil"],
        message: "effectiveFrom cannot be later than effectiveUntil",
      });
    }
  });

const availabilityRuleUpdateSchema = z
  .object({
    branchId: uuid.optional(),
    staffId: uuid.optional(),
    dayOfWeek: z.coerce.number().int().min(0).max(6).optional(),
    startTimeMinutes: z.coerce.number().int().min(0).max(1439).optional(),
    endTimeMinutes: z.coerce.number().int().min(1).max(1440).optional(),
    effectiveFrom: optionalDate,
    effectiveUntil: optionalDate,
    status: status.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

const timeBlockSchema = z.object({
  branchId: uuid,
  staffId: uuid,
  date: z.string().date(),
  startTime: z.iso.datetime({ offset: true }),
  endTime: z.iso.datetime({ offset: true }),
  type: blockType,
  note: z.string().trim().max(2000).optional(),
});

const timeBlockUpdateSchema = z
  .object({
    branchId: uuid.optional(),
    staffId: uuid.optional(),
    date: z.string().date().optional(),
    startTime: z.iso.datetime({ offset: true }).optional(),
    endTime: z.iso.datetime({ offset: true }).optional(),
    type: blockType.optional(),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

const actorFrom = (req: Request): StaffAvailabilityActor => {
  if (!req.user?.userId) {
    throw new StaffAvailabilityError(401, "Unauthorized");
  }
  return {
    userId: req.user.userId,
    role: req.user.role,
    ...(req.user.salonId ? { salonId: req.user.salonId } : {}),
    ...(req.user.branchId ? { branchId: req.user.branchId } : {}),
    ...(req.user.activeBranchId
      ? { activeBranchId: req.user.activeBranchId }
      : {}),
  };
};

const idFrom = (req: Request) =>
  typeof req.params.id === "string" ? req.params.id : "";

const stringQuery = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const sendError = (res: Response, error: unknown) => {
  if (error instanceof StaffAvailabilityError) {
    return res
      .status(error.status)
      .json({ success: false, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      success: false,
      message: error.issues[0]?.message ?? "Invalid roster request",
      errors: error.issues,
    });
  }
  console.error(error);
  return res.status(500).json({
    success: false,
    message: "Unable to process staff availability request",
  });
};

export const getAvailabilityRules = async (req: Request, res: Response) => {
  try {
    const dayValue = stringQuery(req.query.dayOfWeek);
    const dayOfWeek = dayValue === undefined ? undefined : Number(dayValue);
    if (
      dayOfWeek !== undefined &&
      (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6)
    ) {
      throw new StaffAvailabilityError(
        400,
        "dayOfWeek must be between 0 and 6"
      );
    }
    const statusValue = stringQuery(req.query.status);
    const parsedStatus = statusValue ? status.parse(statusValue) : undefined;
    const data = await listAvailabilityRules(actorFrom(req), {
      ...(stringQuery(req.query.salonId)
        ? { salonId: stringQuery(req.query.salonId)! }
        : {}),
      ...(stringQuery(req.query.branchId)
        ? { branchId: uuid.parse(stringQuery(req.query.branchId)) }
        : {}),
      ...(stringQuery(req.query.staffId)
        ? { staffId: uuid.parse(stringQuery(req.query.staffId)) }
        : {}),
      ...(dayOfWeek !== undefined ? { dayOfWeek } : {}),
      ...(parsedStatus ? { status: parsedStatus } : {}),
    });
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getAvailabilityRuleById = async (
  req: Request,
  res: Response
) => {
  try {
    return res.json({
      success: true,
      data: await getAvailabilityRule(actorFrom(req), idFrom(req)),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const postAvailabilityRule = async (req: Request, res: Response) => {
  try {
    const input = availabilityRuleSchema.parse(req.body);
    const data = await createAvailabilityRule(
      actorFrom(req),
      {
        branchId: input.branchId,
        staffId: input.staffId,
        dayOfWeek: input.dayOfWeek,
        startTimeMinutes: input.startTimeMinutes,
        endTimeMinutes: input.endTimeMinutes,
        ...(input.effectiveFrom !== undefined
          ? {
              effectiveFrom:
                input.effectiveFrom === null
                  ? null
                  : parseDateOnly(input.effectiveFrom),
            }
          : {}),
        ...(input.effectiveUntil !== undefined
          ? {
              effectiveUntil:
                input.effectiveUntil === null
                  ? null
                  : parseDateOnly(input.effectiveUntil),
            }
          : {}),
        ...(input.status ? { status: input.status } : {}),
      },
      requestAuditContext(req)
    );
    return res.status(201).json({
      success: true,
      message: "Availability rule created successfully",
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const putAvailabilityRule = async (req: Request, res: Response) => {
  try {
    const input = availabilityRuleUpdateSchema.parse(req.body);
    const data = await updateAvailabilityRule(
      actorFrom(req),
      idFrom(req),
      {
        ...(input.branchId ? { branchId: input.branchId } : {}),
        ...(input.staffId ? { staffId: input.staffId } : {}),
        ...(input.dayOfWeek !== undefined
          ? { dayOfWeek: input.dayOfWeek }
          : {}),
        ...(input.startTimeMinutes !== undefined
          ? { startTimeMinutes: input.startTimeMinutes }
          : {}),
        ...(input.endTimeMinutes !== undefined
          ? { endTimeMinutes: input.endTimeMinutes }
          : {}),
        ...(input.effectiveFrom !== undefined
          ? {
              effectiveFrom:
                input.effectiveFrom === null
                  ? null
                  : parseDateOnly(input.effectiveFrom),
            }
          : {}),
        ...(input.effectiveUntil !== undefined
          ? {
              effectiveUntil:
                input.effectiveUntil === null
                  ? null
                  : parseDateOnly(input.effectiveUntil),
            }
          : {}),
        ...(input.status ? { status: input.status } : {}),
      },
      requestAuditContext(req)
    );
    return res.json({
      success: true,
      message: "Availability rule updated successfully",
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const patchAvailabilityRuleStatus = async (
  req: Request,
  res: Response
) => {
  try {
    const parsedStatus = status.parse(req.body.status);
    return res.json({
      success: true,
      message: "Availability rule status updated successfully",
      data: await setAvailabilityRuleStatus(
        actorFrom(req),
        idFrom(req),
        parsedStatus,
        requestAuditContext(req)
      ),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const removeAvailabilityRule = async (
  req: Request,
  res: Response
) => {
  try {
    return res.json({
      success: true,
      message: "Availability rule deleted successfully",
      data: await deleteAvailabilityRule(
        actorFrom(req),
        idFrom(req),
        requestAuditContext(req)
      ),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getSlots = async (req: Request, res: Response) => {
  try {
    const branchId = uuid.parse(stringQuery(req.query.branchId));
    const date = z.string().date().parse(stringQuery(req.query.date));
    const serviceIds = (stringQuery(req.query.serviceIds) ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => uuid.parse(value));
    const staffIdValue = stringQuery(req.query.staffId);
    return res.json({
      success: true,
      data: await getAvailableSlots(actorFrom(req), {
        branchId,
        serviceIds,
        date,
        ...(staffIdValue ? { staffId: uuid.parse(staffIdValue) } : {}),
      }),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getTimeBlocks = async (req: Request, res: Response) => {
  try {
    const startDateValue = stringQuery(req.query.startDate);
    const endDateValue = stringQuery(req.query.endDate);
    const data = await listTimeBlocks(actorFrom(req), {
      ...(stringQuery(req.query.salonId)
        ? { salonId: uuid.parse(stringQuery(req.query.salonId)) }
        : {}),
      ...(stringQuery(req.query.branchId)
        ? { branchId: uuid.parse(stringQuery(req.query.branchId)) }
        : {}),
      ...(stringQuery(req.query.staffId)
        ? { staffId: uuid.parse(stringQuery(req.query.staffId)) }
        : {}),
      ...(startDateValue ? { startDate: parseDateOnly(startDateValue) } : {}),
      ...(endDateValue ? { endDate: parseDateOnly(endDateValue) } : {}),
    });
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getTimeBlockById = async (req: Request, res: Response) => {
  try {
    return res.json({
      success: true,
      data: await getTimeBlock(actorFrom(req), idFrom(req)),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const postTimeBlock = async (req: Request, res: Response) => {
  try {
    const input = timeBlockSchema.parse(req.body);
    const data = await createTimeBlock(
      actorFrom(req),
      {
        branchId: input.branchId,
        staffId: input.staffId,
        date: parseDateOnly(input.date),
        startTime: new Date(input.startTime),
        endTime: new Date(input.endTime),
        type: input.type,
        ...(input.note ? { note: input.note } : {}),
      },
      requestAuditContext(req)
    );
    return res.status(201).json({
      success: true,
      message: "Time block created successfully",
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const putTimeBlock = async (req: Request, res: Response) => {
  try {
    const input = timeBlockUpdateSchema.parse(req.body);
    const data = await updateTimeBlock(
      actorFrom(req),
      idFrom(req),
      {
        ...(input.branchId ? { branchId: input.branchId } : {}),
        ...(input.staffId ? { staffId: input.staffId } : {}),
        ...(input.date ? { date: parseDateOnly(input.date) } : {}),
        ...(input.startTime
          ? { startTime: new Date(input.startTime) }
          : {}),
        ...(input.endTime ? { endTime: new Date(input.endTime) } : {}),
        ...(input.type ? { type: input.type } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
      requestAuditContext(req)
    );
    return res.json({
      success: true,
      message: "Time block updated successfully",
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const removeTimeBlock = async (req: Request, res: Response) => {
  try {
    return res.json({
      success: true,
      message: "Time block deleted successfully",
      data: await deleteTimeBlock(
        actorFrom(req),
        idFrom(req),
        requestAuditContext(req)
      ),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getRoster = async (req: Request, res: Response) => {
  try {
    const startDate = z
      .string()
      .date()
      .parse(stringQuery(req.query.startDate));
    const endDate = z.string().date().parse(stringQuery(req.query.endDate));
    const data = await getStaffRoster(actorFrom(req), {
      startDate,
      endDate,
      ...(stringQuery(req.query.salonId)
        ? { salonId: uuid.parse(stringQuery(req.query.salonId)) }
        : {}),
      ...(stringQuery(req.query.branchId)
        ? { branchId: uuid.parse(stringQuery(req.query.branchId)) }
        : {}),
      ...(stringQuery(req.query.staffId)
        ? { staffId: uuid.parse(stringQuery(req.query.staffId)) }
        : {}),
    });
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};
