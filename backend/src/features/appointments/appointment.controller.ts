import { type Request, type Response } from "express";

import { AppointmentModel, LATE_NO_SHOW_MS, resolveStaffIdFilter } from "./appointment.model.js";
import { CustomerModel } from "../customers/customer.model.js";
import { StaffModel } from "../staff/staff.model.js";
import { BranchModel } from "../branches/branch.model.js";
import { ServiceModel } from "../services/service.model.js";
import { SalonModel } from "../salons/salon.model.js";
import { parseSalonDateRange } from "../../utils/timezone.js";
import { sendInventoryError } from "../products/inventory-access.js";
import {
  createAuditLog,
  requestAuditContext,
} from "../audit-logs/audit-log.service.js";
import { prisma } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { buildBusinessCode } from "../../utils/business-id.js";
import { reverseAppointmentConsumables } from "../stock/appointmentConsumableReversal.service.js";
import { reverseUsedPackageUsagesForAppointment } from "../packages/package.service.js";
import { serviceUsageSchema } from "../stock/serviceUsage.service.js";
import {
  checkStaffAvailabilityForSlot,
  StaffAvailabilityError,
} from "../staff-availability/staffAvailability.service.js";
import {
  branchFilterFor,
  isBranchLockedRole,
  pinnedBranchId,
} from "../../utils/branch-scope.js";

const APPOINTMENT_STATUSES = [
    "SCHEDULED",
    "CONFIRMED",
    "CHECKED_IN",
    "COMPLETED",
    "CANCELLED",
    "NO_SHOW",
] as const;

type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

const isValidAppointmentStatus = (
    status: string
): status is AppointmentStatus => {
    return APPOINTMENT_STATUSES.includes(status as AppointmentStatus);
};

const getFinalSalonId = (req: Request, bodySalonId?: string) => {
    if (req.user?.role === "SUPER_ADMIN") {
        return bodySalonId;
    }

    return req.user?.salonId;
};

const getAppointmentIdParam = (req: Request) => {
    const { id } = req.params;
    return typeof id === "string" ? id : null;
};

const generateAppointmentCode = (salonName: string, timezone?: string | null) =>
    buildBusinessCode({ salonName, type: "APT", timezone });

const durationToMinutes = (
    durationValue?: number | null,
    durationUnit?: "MINUTES" | "HOURS" | null
) => {
    if (!durationValue) {
        return 0;
    }

    if (durationUnit === "HOURS") {
        return durationValue * 60;
    }

    return durationValue;
};

const getDateRange = (
    from: string | undefined,
    to: string | undefined,
    timezone: string
) => {
    if (!from && !to) {
        return {};
    }

    const range = parseSalonDateRange(from || to!, to || from!, timezone);

    return {
        ...(range.start ? { dateFrom: range.start } : {}),
        ...(range.end ? { dateTo: range.end } : {}),
    };
};

// Late bookings move on by themselves: an hour past the start with nobody in
// is a no-show, and by the next salon day it is cancelled. Job carts are
// walk-ins with their own lifecycle, so they are never touched here.
// Staff checks apply the same hour on their own (staffBlockingAppointmentWhere),
// so a stylist is freed even before this runs.
const sweepLateAppointments = async (input: { salonId?: string; branchId?: string; timezone: string }) => {
    const dateParts = new Intl.DateTimeFormat("en-US", { timeZone: input.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).reduce<Record<string, string>>((parts, part) => ({ ...parts, [part.type]: part.value }), {});
    const today = dateParts.year + "-" + dateParts.month + "-" + dateParts.day;
    const startOfToday = getDateRange(today, today, input.timezone).dateFrom;
    if (!startOfToday) return;
    const moves: Array<{ from: AppointmentStatus[]; to: AppointmentStatus; before: Date; note: string }> = [
        { from: ["SCHEDULED", "CONFIRMED", "NO_SHOW"], to: "CANCELLED", before: startOfToday, note: "Auto-cancelled: not attended by the next day" },
        { from: ["SCHEDULED", "CONFIRMED"], to: "NO_SHOW", before: new Date(Date.now() - LATE_NO_SHOW_MS), note: "Auto no-show: an hour past the start time" },
    ];
    for (const move of moves) {
        await prisma.$transaction(async (tx) => {
            // One statement picks and moves the rows, skipping any another
            // request holds, so overlapping list loads never log a move twice.
            const moved = await tx.$queryRaw<Array<{ id: string; oldStatus: AppointmentStatus }>>`
                WITH due AS (
                    SELECT "id", "status" FROM "Appointment"
                    WHERE "walkInJobCart" = false
                      AND "status"::text IN (${Prisma.join(move.from)})
                      AND "startTime" < ${move.before}
                      ${input.salonId ? Prisma.sql`AND "salonId" = ${input.salonId}` : Prisma.empty}
                      ${input.branchId ? Prisma.sql`AND "branchId" = ${input.branchId}` : Prisma.empty}
                    FOR UPDATE SKIP LOCKED
                )
                UPDATE "Appointment" AS a
                SET "status" = ${move.to}::"AppointmentStatus", "updatedAt" = NOW()
                FROM due
                WHERE a."id" = due."id"
                RETURNING a."id", due."status"::text AS "oldStatus"`;
            if (!moved.length) return;
            await tx.appointmentStatusHistory.createMany({
                data: moved.map((row) => ({
                    appointmentId: row.id,
                    oldStatus: row.oldStatus,
                    newStatus: move.to,
                    note: move.note,
                })),
            });
        });
    }
};

class AppointmentInputError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}

// Validates a booking cart: the primary stylist, the services, and any
// per-service stylist, price or quantity. Booking and editing share it.
const resolveBookingServices = async (
    req: Request,
    input: { salonId: string; staffId: string; serviceIds: string[]; serviceItems: unknown }
) => {
    const { salonId, staffId, serviceIds } = input;
    const staff = await StaffModel.findByIdAndSalon(staffId, salonId, branchFilterFor(req));
    if (!staff) throw new AppointmentInputError(400, "Invalid staff for this salon");

    const services = await ServiceModel.findManyByIdsAndSalon(serviceIds, salonId);
    if (services.length !== serviceIds.length) {
        throw new AppointmentInputError(400, "One or more services are invalid for this salon");
    }

    if (
        isBranchLockedRole(req.user?.role) &&
        req.user?.branchId &&
        services.some(
            (service) =>
                service.branchId !== null &&
                service.branchId !== req.user?.branchId
        )
    ) {
        throw new AppointmentInputError(403, "You do not have access to this branch");
    }

    if (!staff.status) throw new AppointmentInputError(400, "Inactive staff cannot be booked");

    // The booking cart assigns a stylist per service. Anything left
    // unassigned falls back to the appointment's primary staff.
    const staffByServiceId = new Map<string, string>();
    const priceByServiceId = new Map<string, number>();
    const quantityByServiceId = new Map<string, number>();
    const items = (Array.isArray(input.serviceItems) ? input.serviceItems : []) as Array<{
        serviceId?: unknown;
        staffId?: unknown;
        price?: unknown;
        quantity?: unknown;
    } | null>;
    for (const item of items) {
        if (item?.serviceId && item?.staffId) {
            staffByServiceId.set(String(item.serviceId), String(item.staffId));
        }
        if (item?.serviceId && item?.price !== undefined) {
            const price = Number(item.price);
            if (!Number.isFinite(price) || price < 0) {
                throw new AppointmentInputError(400, "Service prices must be valid non-negative numbers");
            }
            priceByServiceId.set(String(item.serviceId), price);
        }
        if (item?.serviceId && item?.quantity !== undefined) {
            const quantity = Number(item.quantity);
            if (!Number.isInteger(quantity) || quantity < 1) {
                throw new AppointmentInputError(400, "Service quantities must be whole numbers of at least 1");
            }
            quantityByServiceId.set(String(item.serviceId), quantity);
        }
    }

    const itemServiceIds = new Set([
        ...staffByServiceId.keys(),
        ...priceByServiceId.keys(),
        ...quantityByServiceId.keys(),
    ]);
    if ([...itemServiceIds].some((id) => !serviceIds.includes(id))) {
        throw new AppointmentInputError(400, "serviceItems must reference the booked services");
    }

    const extraStaffIds = [...new Set(staffByServiceId.values())].filter(
        (id) => id !== staffId
    );
    const extraStaff = await Promise.all(
        extraStaffIds.map((id) =>
            StaffModel.findByIdAndSalon(id, salonId, branchFilterFor(req))
        )
    );
    if (extraStaff.some((member) => !member || !member.status)) {
        throw new AppointmentInputError(
            400,
            "One or more assigned staff are invalid or inactive for this salon"
        );
    }

    const lines = services.map((service) => ({
        serviceId: service.id,
        serviceName: service.name,
        price: priceByServiceId.get(service.id) ?? Number(service.price),
        quantity: quantityByServiceId.get(service.id) ?? 1,
        staffId: staffByServiceId.get(service.id) ?? staffId,
        ...(service.durationValue !== null && service.durationValue !== undefined
            ? { durationValue: service.durationValue }
            : {}),
        ...(service.durationUnit ? { durationUnit: service.durationUnit } : {}),
    }));

    return {
        // Sorted so two concurrent bookings lock stylists in the same order.
        staffIds: [staff.id, ...extraStaffIds].sort(),
        lines,
        totalDurationMinutes: services.reduce(
            (total, service) =>
                total + durationToMinutes(service.durationValue, service.durationUnit),
            0
        ),
        estimatedAmount: lines.reduce(
            (total, line) => total + line.price * line.quantity,
            0
        ),
    };
};

// Every stylist on the cart is checked, not just the primary one, or a
// per-service assignment could quietly double-book someone.
const assertStaffFree = async (
    tx: Prisma.TransactionClient,
    input: {
        staffIds: string[];
        startTime: Date;
        endTime: Date;
        salonId: string;
        branchId?: string | null;
        excludeAppointmentId?: string;
    }
) => {
    for (const bookedStaffId of input.staffIds) {
        await tx.$queryRaw`SELECT "id" FROM "Staff" WHERE "id" = ${bookedStaffId} FOR UPDATE`;
        const availability = await checkStaffAvailabilityForSlot({
            client: tx,
            staffId: bookedStaffId,
            startTime: input.startTime,
            endTime: input.endTime,
            salonId: input.salonId,
            shiftRule: "START_IN_SHIFT",
            ...(input.branchId ? { branchId: input.branchId } : {}),
            ...(input.excludeAppointmentId
                ? { excludeAppointmentId: input.excludeAppointmentId }
                : {}),
        });
        if (!availability.available) {
            throw new StaffAvailabilityError(
                availability.reason === "APPOINTMENT_CONFLICT" ? 409 : 400,
                availability.message
            );
        }
    }
};

const getExistingAppointmentByAccess = async (
    req: Request,
    appointmentId: string
) => {
    if (req.user?.role === "SUPER_ADMIN") {
        return AppointmentModel.findById(appointmentId);
    }

    const salonId = req.user?.salonId;

    if (!salonId) {
        return null;
    }

    return AppointmentModel.findByIdAndSalon(
        appointmentId,
        salonId,
        branchFilterFor(req)
    );
};

export const createAppointment = async (req: Request, res: Response) => {
    try {
        const {
            salonId,
            branchId,
            customerId,
            staffId,
            serviceIds,
            serviceItems,
            startTime,
            status,
            bookingNote,
            internalNote,
        } = req.body;

        if (!customerId || !staffId || !startTime || !serviceIds?.length) {
            return res.status(400).json({
                success: false,
                message: "customerId, staffId, startTime and serviceIds are required",
            });
        }

        if (status && !isValidAppointmentStatus(status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid appointment status",
            });
        }

        const finalSalonId = getFinalSalonId(req, salonId);

        if (!finalSalonId) {
            return res.status(400).json({
                success: false,
                message: "Salon ID is required",
            });
        }

        let finalBranchId: string | undefined = branchId;

        const pinnedBranch = pinnedBranchId(req.user);

        if (pinnedBranch) {
            // A branch-locked role reaching for another branch is overreaching;
            // a salon-wide role just has a session open, so that session wins.
            if (
                branchId &&
                branchId !== pinnedBranch &&
                !req.user?.activeBranchId
            ) {
                return res.status(403).json({
                    success: false,
                    message: "You do not have access to this branch",
                });
            }

            finalBranchId = pinnedBranch;
        }

        const customer = await CustomerModel.findByIdAndSalon(
            customerId,
            finalSalonId,
            branchFilterFor(req)
        );

        if (!customer) {
            return res.status(400).json({
                success: false,
                message: "Invalid customer for this salon",
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

        const booking = await resolveBookingServices(req, {
            salonId: finalSalonId,
            staffId,
            serviceIds,
            serviceItems,
        });
        const { totalDurationMinutes, estimatedAmount } = booking;

        const finalStartTime = new Date(startTime);

        if (Number.isNaN(finalStartTime.getTime())) {
            return res.status(400).json({
                success: false,
                message: "Invalid startTime",
            });
        }

        if (finalStartTime < new Date()) {
            return res.status(400).json({
                success: false,
                message: "Appointment start time cannot be in the past",
            });
        }

        const finalEndTime = new Date(
            finalStartTime.getTime() + totalDurationMinutes * 60 * 1000
        );

        const salon = await SalonModel.findById(finalSalonId);
        if (!salon) {
            return res.status(400).json({ success: false, message: "Salon not found" });
        }
        const appointment = await prisma.$transaction(async (tx) => {
          await assertStaffFree(tx, {
            staffIds: booking.staffIds,
            startTime: finalStartTime,
            endTime: finalEndTime,
            salonId: finalSalonId,
            branchId: finalBranchId ?? null,
          });
          const created = await AppointmentModel.create({
            appointmentCode: generateAppointmentCode(salon.name, salon.timezone),
            salonId: finalSalonId,
            ...(finalBranchId ? { branchId: finalBranchId } : {}),
            customerId,
            staffId,
            ...(req.user?.userId ? { createdById: req.user.userId } : {}),
            startTime: finalStartTime,
            endTime: finalEndTime,
            totalDurationMinutes,
            estimatedAmount,
            ...(status ? { status } : {}),
            ...(bookingNote ? { bookingNote } : {}),
            ...(internalNote ? { internalNote } : {}),
            services: booking.lines,
          }, tx);

          await createAuditLog({
            tx,
            salonId: created.salonId,
            branchId: created.branchId,
            userId: req.user?.userId,
            module: "APPOINTMENT",
            action: "CREATE",
            entityId: created.id,
            entityCode: created.appointmentCode,
            entityName: created.customer.name,
            description: `Appointment ${created.appointmentCode} created for ${created.customer.name}`,
            newData: {
                status: created.status,
                startTime: created.startTime,
                staffId: created.staffId,
                customerId: created.customerId,
                serviceIds,
            },
            ...requestAuditContext(req),
          });
          return created;
        });

        return res.status(201).json({
            success: true,
            message: "Appointment created successfully",
            data: appointment,
        });
    } catch (error) {
        if (error instanceof StaffAvailabilityError || error instanceof AppointmentInputError) {
            return res.status(error.status).json({
                success: false,
                message: error.message,
            });
        }
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });

    }
};

export const getAppointments = async (req: Request, res: Response) => {
    try {
        const { branchId, staffId, customerId, status, date, from, to } = req.query;

        if (from && to && String(from) > String(to)) {
            return res.status(400).json({
                success: false,
                message: "Invalid date range",
            });
        }

        if (status && !isValidAppointmentStatus(String(status))) {
            return res.status(400).json({
                success: false,
                message: "Invalid appointment status",
            });
        }

        const listStaffId = await resolveStaffIdFilter(
            staffId ? String(staffId) : undefined,
            req.user?.userId
        );
        const listFilters = {
            ...(listStaffId ? { staffId: listStaffId } : {}),
            ...(customerId ? { customerId: String(customerId) } : {}),
            ...(status ? { status: String(status) as AppointmentStatus } : {}),
        };

        const dateRangeIn = {
            from: from ? String(from) : date ? String(date) : undefined,
            to: to ? String(to) : date ? String(date) : undefined,
        };

        if (req.user?.role === "SUPER_ADMIN") {
            await sweepLateAppointments({ timezone: "Asia/Kolkata", ...(branchId ? { branchId: String(branchId) } : {}) });
            const appointments = await AppointmentModel.findAll({
                ...listFilters,
                ...(branchId ? { branchId: String(branchId) } : {}),
                // No single salon in scope, so fall back to the platform default zone.
                ...getDateRange(dateRangeIn.from, dateRangeIn.to, "Asia/Kolkata"),
            });

            return res.status(200).json({
                success: true,
                message: "Appointments fetched successfully",
                data: appointments,
            });
        }

        if (!req.user?.salonId) {
            return res.status(400).json({
                success: false,
                message: "Salon ID is missing",
            });
        }

        const listBranchId = pinnedBranchId(req.user);

        if (
            listBranchId &&
            branchId &&
            String(branchId) !== listBranchId &&
            !req.user.activeBranchId
        ) {
            return res.status(403).json({
                success: false,
                message: "You do not have access to this branch",
            });
        }

        const salon = await SalonModel.findById(req.user.salonId);
        await sweepLateAppointments({
            salonId: req.user.salonId,
            ...(listBranchId ? { branchId: listBranchId } : branchId ? { branchId: String(branchId) } : {}),
            timezone: salon?.timezone ?? "Asia/Kolkata",
        });
        const appointments = await AppointmentModel.findBySalon(req.user.salonId, {
            ...(listBranchId
                ? { branchId: listBranchId }
                : branchId
                  ? { branchId: String(branchId) }
                  : {}),
            ...listFilters,
            ...getDateRange(
                dateRangeIn.from,
                dateRangeIn.to,
                salon?.timezone ?? "Asia/Kolkata"
            ),
        });

        return res.status(200).json({
            success: true,
            message: "Appointments fetched successfully",
            data: appointments,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};

export const getAppointmentById = async (req: Request, res: Response) => {
    try {
        const id = getAppointmentIdParam(req);

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Appointment ID is required",
            });
        }

        const appointment = await getExistingAppointmentByAccess(req, id);

        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: "Appointment not found",
            });
        }

        return res.status(200).json({
            success: true,
            message: "Appointment fetched successfully",
            data: appointment,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};

export const updateAppointmentStatus = async (
    req: Request,
    res: Response
) => {
    try {
        const id = getAppointmentIdParam(req);

        const { status, note } = req.body as {
            status?: string;
            note?: string;
        };

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Appointment ID is required",
            });
        }

        if (!status || !isValidAppointmentStatus(status)) {
            return res.status(400).json({
                success: false,
                message: "Valid status is required",
            });
        }

        // Actual consumable use confirmed on completion; without it the
        // service defaults are booked.
        const usage =
            req.body?.usage === undefined
                ? undefined
                : serviceUsageSchema.safeParse(req.body.usage);
        if (usage && !usage.success) {
            return res.status(400).json({
                success: false,
                message: usage.error.issues[0]?.message || "Invalid product usage",
            });
        }

        const existingAppointment = await getExistingAppointmentByAccess(req, id);

        if (!existingAppointment) {
            return res.status(404).json({
                success: false,
                message: "Appointment not found",
            });
        }

        if (existingAppointment.status === status) {
            return res.status(400).json({
                success: false,
                message: "Appointment already has this status",
            });
        }

        // The job cart books what the visit used and completes this
        // appointment with it; completing it here as well would book it twice.
        if (
            status === "COMPLETED" &&
            (await prisma.appointment.findUnique({
                where: { sourceAppointmentId: id },
                select: { id: true },
            }))
        ) {
            return res.status(409).json({
                success: false,
                message: "Complete this appointment from its job cart",
            });
        }

        const appointment = await prisma.$transaction(async (tx) => {
          if (
            existingAppointment.status === "COMPLETED" &&
            status === "CANCELLED"
          ) {
            await reverseAppointmentConsumables({
              tx,
              appointmentId: id,
              salonId: existingAppointment.salonId,
              branchId: existingAppointment.branchId,
              createdById: req.user?.userId,
            });
            await reverseUsedPackageUsagesForAppointment(tx, {
              appointmentId: id,
              userId: req.user?.userId,
              ...requestAuditContext(req),
            });
          }
          const updated = await AppointmentModel.updateStatusWithHistory(id, {
              oldStatus: existingAppointment.status,
              newStatus: status,
              ...(note ? { note } : {}),
              ...(req.user?.userId ? { changedById: req.user.userId } : {}),
              ...(usage?.data ? { usage: usage.data } : {}),
          }, tx);
          await createAuditLog({
            tx,
            salonId: existingAppointment.salonId,
            branchId: existingAppointment.branchId,
            userId: req.user?.userId,
            module: "APPOINTMENT",
            action:
                status === "COMPLETED"
                    ? "COMPLETE"
                    : status === "CANCELLED"
                      ? "CANCEL"
                      : "STATUS_CHANGE",
            entityId: updated.id,
            entityCode: updated.appointmentCode,
            entityName: updated.customer.name,
            description: `Appointment ${updated.appointmentCode} changed from ${existingAppointment.status} to ${status}`,
            oldData: { status: existingAppointment.status },
            newData: { status },
            ...requestAuditContext(req),
          });
          return updated;
        });

        return res.status(200).json({
            success: true,
            message: "Appointment status updated successfully",
            data: appointment,
        });

    } catch (error) {
        return sendInventoryError(res, error);
    }
};

export const updateAppointmentBasicDetails = async (
    req: Request,
    res: Response
) => {
    try {
        const id = getAppointmentIdParam(req);
        const { bookingNote, internalNote, status } = req.body;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Appointment ID is required",
            });
        }

        if (status && !isValidAppointmentStatus(status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid appointment status",
            });
        }

        const existingAppointment = await getExistingAppointmentByAccess(req, id);

        if (!existingAppointment) {
            return res.status(404).json({
                success: false,
                message: "Appointment not found",
            });
        }

        if (["COMPLETED", "CANCELLED"].includes(existingAppointment.status)) {
            return res.status(400).json({
                success: false,
                message: "Completed, cancelled or no-show appointments cannot be edited",
            });
        }

        const updatedAppointment = await prisma.$transaction(async (tx) => {
          const updated = await AppointmentModel.updateBasicDetails(id, {
            ...("bookingNote" in req.body
                ? { bookingNote: bookingNote ?? null }
                : {}),
            ...("internalNote" in req.body
                ? { internalNote: internalNote ?? null }
                : {}),
            ...(status ? { status } : {}),
          }, tx);

          await createAuditLog({
            tx,
            salonId: existingAppointment.salonId,
            branchId: existingAppointment.branchId,
            userId: req.user?.userId,
            module: "APPOINTMENT",
            action: "UPDATE",
            entityId: updated.id,
            entityCode: updated.appointmentCode,
            entityName: updated.customer.name,
            description: `Appointment ${updated.appointmentCode} updated`,
            oldData: {
                bookingNote: existingAppointment.bookingNote,
                internalNote: existingAppointment.internalNote,
                status: existingAppointment.status,
            },
            newData: {
                bookingNote: updated.bookingNote,
                internalNote: updated.internalNote,
                status: updated.status,
            },
            ...requestAuditContext(req),
          });
          return updated;
        });

        return res.status(200).json({
            success: true,
            message: "Appointment updated successfully",
            data: updatedAppointment,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};

export const rescheduleAppointment = async (
    req: Request,
    res: Response
) => {
    try {
        const id = getAppointmentIdParam(req);

        const { startTime } = req.body as {
            startTime?: string;
        };

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Appointment ID is required",
            });
        }

        if (!startTime) {
            return res.status(400).json({
                success: false,
                message: "New startTime is required",
            });
        }

        const existingAppointment = await getExistingAppointmentByAccess(req, id);

        if (!existingAppointment) {
            return res.status(404).json({
                success: false,
                message: "Appointment not found",
            });
        }

        if (
            existingAppointment.status === "COMPLETED" ||
            existingAppointment.status === "CANCELLED"
        ) {
            return res.status(400).json({
                success: false,
                message: "Completed or cancelled appointments cannot be rescheduled",
            });
        }

        const finalStartTime = new Date(startTime);

        if (Number.isNaN(finalStartTime.getTime())) {
            return res.status(400).json({
                success: false,
                message: "Invalid startTime",
            });
        }

        if (finalStartTime < new Date()) {
            return res.status(400).json({
                success: false,
                message: "Appointment start time cannot be in the past",
            });
        }

        if (existingAppointment.totalDurationMinutes <= 0) {
            return res.status(400).json({
                success: false,
                message: "Appointment duration is invalid",
            });
        }

        const finalEndTime = new Date(
            finalStartTime.getTime() +
            existingAppointment.totalDurationMinutes * 60 * 1000
        );

        const updatedAppointment = await prisma.$transaction(async (tx) => {
          if (existingAppointment.staffId) {
            await tx.$queryRaw`SELECT "id" FROM "Staff" WHERE "id" = ${existingAppointment.staffId} FOR UPDATE`;
            const availability = await checkStaffAvailabilityForSlot({
                client: tx,
                staffId: existingAppointment.staffId,
                startTime: finalStartTime,
                endTime: finalEndTime,
                shiftRule: "START_IN_SHIFT",
                excludeAppointmentId: id,
                salonId: existingAppointment.salonId,
                ...(existingAppointment.branchId
                  ? { branchId: existingAppointment.branchId }
                  : {}),
            });
            if (!availability.available) {
                throw new StaffAvailabilityError(
                    availability.reason === "APPOINTMENT_CONFLICT" ? 409 : 400,
                    availability.message
                );
            }
          }
          const updated = await AppointmentModel.updateSchedule(id, {
            startTime: finalStartTime,
            endTime: finalEndTime,
          }, tx);

          // A no-show is terminal for the original slot only. Rescheduling it
          // opens the appointment again so the new visit can create a job cart.
          const rescheduled =
            existingAppointment.status === "NO_SHOW"
              ? await AppointmentModel.updateStatusWithHistory(
                  id,
                  {
                    oldStatus: "NO_SHOW",
                    newStatus: "SCHEDULED",
                    note: "Appointment rescheduled",
                    ...(req.user?.userId ? { changedById: req.user.userId } : {}),
                  },
                  tx
                )
              : updated;

          await createAuditLog({
            tx,
            salonId: existingAppointment.salonId,
            branchId: existingAppointment.branchId,
            userId: req.user?.userId,
            module: "APPOINTMENT",
            action: "UPDATE",
            entityId: rescheduled.id,
            entityCode: rescheduled.appointmentCode,
            entityName: rescheduled.customer.name,
            description: "Appointment " + rescheduled.appointmentCode + " rescheduled",
            oldData: {
                startTime: existingAppointment.startTime,
                endTime: existingAppointment.endTime,
            },
            newData: {
                startTime: rescheduled.startTime,
                endTime: rescheduled.endTime,
                status: rescheduled.status,
            },
            ...requestAuditContext(req),
          });
          return rescheduled;
        });

        return res.status(200).json({
            success: true,
            message: "Appointment rescheduled successfully",
            data: updatedAppointment,
        });
    } catch (error) {
        if (error instanceof StaffAvailabilityError) {
            return res.status(error.status).json({
                success: false,
                message: error.message,
            });
        }
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};

// Services on a booking can change until the visit starts; after that the
// job cart owns them.
const EDITABLE_SERVICE_STATUSES = ["SCHEDULED", "CONFIRMED"];

export const updateAppointmentServices = async (
    req: Request,
    res: Response
) => {
    try {
        const id = getAppointmentIdParam(req);
        const { staffId, serviceIds, serviceItems } = req.body as {
            staffId?: string;
            serviceIds?: string[];
            serviceItems?: unknown;
        };

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Appointment ID is required",
            });
        }

        if (!staffId || !Array.isArray(serviceIds) || !serviceIds.length) {
            return res.status(400).json({
                success: false,
                message: "staffId and serviceIds are required",
            });
        }

        const existingAppointment = await getExistingAppointmentByAccess(req, id);

        if (!existingAppointment || existingAppointment.walkInJobCart) {
            return res.status(404).json({
                success: false,
                message: "Appointment not found",
            });
        }

        const booking = await resolveBookingServices(req, {
            salonId: existingAppointment.salonId,
            staffId,
            serviceIds,
            serviceItems,
        });
        const endTime = new Date(
            existingAppointment.startTime.getTime() +
            booking.totalDurationMinutes * 60 * 1000
        );

        const updatedAppointment = await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "Appointment" WHERE "id" = ${id} FOR UPDATE`;
          const current = await tx.appointment.findUniqueOrThrow({
            where: { id },
            select: { status: true, generatedJobCart: { select: { id: true } } },
          });
          if (
            !EDITABLE_SERVICE_STATUSES.includes(current.status) ||
            current.generatedJobCart
          ) {
            throw new AppointmentInputError(
              409,
              "Services can only change before the job cart is started"
            );
          }
          await assertStaffFree(tx, {
            staffIds: booking.staffIds,
            startTime: existingAppointment.startTime,
            endTime,
            salonId: existingAppointment.salonId,
            branchId: existingAppointment.branchId,
            excludeAppointmentId: id,
          });
          const updated = await AppointmentModel.replaceServices(id, {
            startTime: existingAppointment.startTime,
            endTime,
            staffId,
            totalDurationMinutes: booking.totalDurationMinutes,
            estimatedAmount: booking.estimatedAmount,
            services: booking.lines,
          }, tx);
          await createAuditLog({
            tx,
            salonId: existingAppointment.salonId,
            branchId: existingAppointment.branchId,
            userId: req.user?.userId,
            module: "APPOINTMENT",
            action: "UPDATE",
            entityId: updated.id,
            entityCode: updated.appointmentCode,
            entityName: updated.customer.name,
            description: `Appointment ${updated.appointmentCode} services updated`,
            oldData: {
                serviceIds: existingAppointment.services.map((item) => item.serviceId),
                estimatedAmount: existingAppointment.estimatedAmount,
            },
            newData: {
                serviceIds,
                estimatedAmount: booking.estimatedAmount,
            },
            ...requestAuditContext(req),
          });
          return updated;
        });

        return res.status(200).json({
            success: true,
            message: "Appointment services updated successfully",
            data: updatedAppointment,
        });
    } catch (error) {
        if (error instanceof StaffAvailabilityError || error instanceof AppointmentInputError) {
            return res.status(error.status).json({
                success: false,
                message: error.message,
            });
        }
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};

export const deleteAppointment = async (req: Request, res: Response) => {
    try {
        const id = getAppointmentIdParam(req);

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Appointment ID is required",
            });
        }

        const existingAppointment = await getExistingAppointmentByAccess(req, id);

        if (!existingAppointment) {
            return res.status(404).json({
                success: false,
                message: "Appointment not found",
            });
        }

        await prisma.$transaction(async (tx) => {
          await AppointmentModel.delete(id, tx);
          await createAuditLog({
            tx,
            salonId: existingAppointment.salonId,
            branchId: existingAppointment.branchId,
            userId: req.user?.userId,
            module: "APPOINTMENT",
            action: "DELETE",
            entityId: existingAppointment.id,
            entityCode: existingAppointment.appointmentCode,
            entityName: existingAppointment.customer.name,
            description: `Appointment ${existingAppointment.appointmentCode} deleted`,
            oldData: {
                status: existingAppointment.status,
                startTime: existingAppointment.startTime,
                customerId: existingAppointment.customerId,
            },
            ...requestAuditContext(req),
          });
        });

        return res.status(200).json({
            success: true,
            message: "Appointment deleted successfully",
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message:
                "Internal server error. Appointment may already be linked with invoice.",
        });
    }
};

export const getAppointmentTracking = async (
  req: Request,
  res: Response
) => {
  try {
    const id = getAppointmentIdParam(req);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Appointment ID is required",
      });
    }

    const existingAppointment = await getExistingAppointmentByAccess(req, id);

    if (!existingAppointment) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found",
      });
    }

    const tracking = await AppointmentModel.findStatusHistory(id);

    return res.status(200).json({
      success: true,
      message: "Appointment tracking fetched successfully",
      data: tracking,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
