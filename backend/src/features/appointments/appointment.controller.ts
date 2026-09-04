import { type Request, type Response } from "express";

import { AppointmentModel } from "./appointment.model.js";
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
import { buildBusinessCode } from "../../utils/business-id.js";
import { reverseAppointmentConsumables } from "../stock/appointmentConsumableReversal.service.js";
import { reverseUsedPackageUsagesForAppointment } from "../packages/package.service.js";
import {
  checkStaffAvailabilityForSlot,
  StaffAvailabilityError,
} from "../staff-availability/staffAvailability.service.js";

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

const getDateRange = (date: string | undefined, timezone: string) => {
    if (!date) {
        return {};
    }

    const range = parseSalonDateRange(date, date, timezone);

    return {
        ...(range.start ? { dateFrom: range.start } : {}),
        ...(range.end ? { dateTo: range.end } : {}),
    };
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
        req.user?.role === "RECEPTIONIST" ? req.user.branchId : undefined
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

        if (req.user?.role === "RECEPTIONIST" && req.user.branchId) {
            if (branchId && branchId !== req.user.branchId) {
                return res.status(403).json({
                    success: false,
                    message: "You do not have access to this branch",
                });
            }

            finalBranchId = req.user.branchId;
        }

        const customer = await CustomerModel.findByIdAndSalon(
            customerId,
            finalSalonId,
            req.user?.role === "RECEPTIONIST" ? req.user.branchId : undefined
        );

        if (!customer) {
            return res.status(400).json({
                success: false,
                message: "Invalid customer for this salon",
            });
        }

        const staff = await StaffModel.findByIdAndSalon(
            staffId,
            finalSalonId,
            req.user?.role === "RECEPTIONIST" ? req.user.branchId : undefined
        );

        if (!staff) {
            return res.status(400).json({
                success: false,
                message: "Invalid staff for this salon",
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

        const services = await ServiceModel.findManyByIdsAndSalon(
            serviceIds,
            finalSalonId
        );

        if (services.length !== serviceIds.length) {
            return res.status(400).json({
                success: false,
                message: "One or more services are invalid for this salon",
            });
        }

        if (
            req.user?.role === "RECEPTIONIST" &&
            req.user.branchId &&
            services.some(
                (service) =>
                    service.branchId !== null &&
                    service.branchId !== req.user?.branchId
            )
        ) {
            return res.status(403).json({
                success: false,
                message: "You do not have access to this branch",
            });
        }

        if (!staff.status) {
            return res.status(400).json({
                success: false,
                message: "Inactive staff cannot be booked",
            });
        }

        // The booking cart assigns a stylist per service. Anything left
        // unassigned falls back to the appointment's primary staff.
        const staffByServiceId = new Map<string, string>();
        for (const item of Array.isArray(serviceItems) ? serviceItems : []) {
            if (item?.serviceId && item?.staffId) {
                staffByServiceId.set(String(item.serviceId), String(item.staffId));
            }
        }

        if ([...staffByServiceId.keys()].some((id) => !serviceIds.includes(id))) {
            return res.status(400).json({
                success: false,
                message: "serviceItems must reference the booked services",
            });
        }

        const extraStaffIds = [...new Set(staffByServiceId.values())].filter(
            (id) => id !== staffId
        );

        const extraStaff = await Promise.all(
            extraStaffIds.map((id) =>
                StaffModel.findByIdAndSalon(
                    id,
                    finalSalonId,
                    req.user?.role === "RECEPTIONIST" ? req.user.branchId : undefined
                )
            )
        );

        if (extraStaff.some((member) => !member || !member.status)) {
            return res.status(400).json({
                success: false,
                message:
                    "One or more assigned staff are invalid or inactive for this salon",
            });
        }

        const totalDurationMinutes = services.reduce((total, service) => {
            return (
                total +
                durationToMinutes(service.durationValue, service.durationUnit)
            );
        }, 0);

        const estimatedAmount = services.reduce((total, service) => {
            return total + Number(service.price);
        }, 0);

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
          // Every stylist on the cart is checked, not just the primary one, or
          // a per-service assignment could quietly double-book someone. Locked
          // in id order so two concurrent bookings cannot deadlock.
          for (const bookedStaffId of [staff.id, ...extraStaffIds].sort()) {
            await tx.$queryRaw`SELECT "id" FROM "Staff" WHERE "id" = ${bookedStaffId} FOR UPDATE`;
            const availability = await checkStaffAvailabilityForSlot({
                client: tx,
                staffId: bookedStaffId,
                startTime: finalStartTime,
                endTime: finalEndTime,
                salonId: finalSalonId,
                ...(finalBranchId ? { branchId: finalBranchId } : {}),
            });
            if (!availability.available) {
                throw new StaffAvailabilityError(
                    availability.reason === "APPOINTMENT_CONFLICT" ? 409 : 400,
                    availability.message
                );
            }
          }
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
            services: services.map((service) => ({
                serviceId: service.id,
                serviceName: service.name,
                price: Number(service.price),
                staffId: staffByServiceId.get(service.id) ?? staffId,

                ...(service.durationValue !== null && service.durationValue !== undefined
                    ? { durationValue: service.durationValue }
                    : {}),

                ...(service.durationUnit
                    ? { durationUnit: service.durationUnit }
                    : {}),
            })),
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

export const getAppointments = async (req: Request, res: Response) => {
    try {
        const { branchId, staffId, customerId, status, date } = req.query;

        if (status && !isValidAppointmentStatus(String(status))) {
            return res.status(400).json({
                success: false,
                message: "Invalid appointment status",
            });
        }

        if (req.user?.role === "SUPER_ADMIN") {
            const appointments = await AppointmentModel.findAll();

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

        if (
            req.user.role === "RECEPTIONIST" &&
            req.user.branchId &&
            branchId &&
            String(branchId) !== req.user.branchId
        ) {
            return res.status(403).json({
                success: false,
                message: "You do not have access to this branch",
            });
        }

        const salon = await SalonModel.findById(req.user.salonId);
        const appointments = await AppointmentModel.findBySalon(req.user.salonId, {
            ...(req.user.role === "RECEPTIONIST" && req.user.branchId
                ? { branchId: req.user.branchId }
                : branchId
                  ? { branchId: String(branchId) }
                  : {}),
            ...(staffId ? { staffId: String(staffId) } : {}),
            ...(customerId ? { customerId: String(customerId) } : {}),
            ...(status ? { status: String(status) as AppointmentStatus } : {}),
            ...getDateRange(date ? String(date) : undefined, salon?.timezone ?? "Asia/Kolkata"),
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

        if (["COMPLETED", "CANCELLED", "NO_SHOW"].includes(existingAppointment.status)) {
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
            existingAppointment.status === "CANCELLED" ||
            existingAppointment.status === "NO_SHOW"
        ) {
            return res.status(400).json({
                success: false,
                message: "Completed, cancelled or no-show appointments cannot be rescheduled",
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
            description: `Appointment ${updated.appointmentCode} rescheduled`,
            oldData: {
                startTime: existingAppointment.startTime,
                endTime: existingAppointment.endTime,
            },
            newData: {
                startTime: updated.startTime,
                endTime: updated.endTime,
            },
            ...requestAuditContext(req),
          });
          return updated;
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
