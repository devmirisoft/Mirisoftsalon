import { prisma } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { transactionError } from "../products/inventory-access.js";
import { createStockMovement } from "../stock/stockMovement.service.js";

type AppointmentStatus =
  | "SCHEDULED"
  | "CONFIRMED"
  | "CHECKED_IN"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW";

type DurationUnit = "MINUTES" | "HOURS";
type TransactionClient = Prisma.TransactionClient;

// Products sold during the visit live on the appointment's invoice, not on the
// appointment itself, so the detail views pull those lines in alongside services.
const soldProductsInclude = {
  invoice: {
    select: {
      id: true,
      invoiceCode: true,
      items: {
        where: { itemType: "PRODUCT" as const },
        select: {
          id: true,
          serviceName: true,
          description: true,
          quantity: true,
          unitPrice: true,
          lineTotal: true,
          soldByStaff: { select: { id: true, name: true } },
        },
      },
    },
  },
} satisfies Prisma.AppointmentInclude;

export const AppointmentModel = {
  create: async (data: {
    appointmentCode: string;
    salonId: string;
    branchId?: string;
    customerId: string;
    staffId?: string;
    createdById?: string;
    startTime: Date;
    endTime: Date;
    totalDurationMinutes: number;
    estimatedAmount: number;
    status?: AppointmentStatus;
    source?: "INTERNAL" | "PUBLIC" | "WALK_IN";
    walkInJobCart?: boolean;
    bookingNote?: string;
    internalNote?: string;
    services: {
      serviceId: string;
      serviceName: string;
      price: number;
      staffId?: string;
      durationValue?: number;
      durationUnit?: DurationUnit;
    }[];
  }, tx?: TransactionClient) => {
    return (tx ?? prisma).appointment.create({
      data: {
        appointmentCode: data.appointmentCode,
        salonId: data.salonId,
        customerId: data.customerId,
        ...(data.staffId ? { staffId: data.staffId } : {}),
        ...(data.createdById ? { createdById: data.createdById } : {}),
        startTime: data.startTime,
        endTime: data.endTime,
        totalDurationMinutes: data.totalDurationMinutes,
        estimatedAmount: data.estimatedAmount,
        status: data.status || "SCHEDULED",
        source: data.source || "INTERNAL",
        walkInJobCart: data.walkInJobCart ?? false,
        ...(data.branchId ? { branchId: data.branchId } : {}),
        ...(data.bookingNote ? { bookingNote: data.bookingNote } : {}),
        ...(data.internalNote ? { internalNote: data.internalNote } : {}),

        services: {
          create: data.services.map((service) => ({
            service: {
              connect: {
                id: service.serviceId,
              },
            },
            serviceName: service.serviceName,
            price: service.price,
            ...(service.staffId
              ? { staff: { connect: { id: service.staffId } } }
              : {}),
            ...(service.durationValue !== undefined
              ? { durationValue: service.durationValue }
              : {}),
            ...(service.durationUnit ? { durationUnit: service.durationUnit } : {}),
          })),
        },
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            customerCode: true,
          },
        },
        staff: {
          select: {
            id: true,
            name: true,
            jobRole: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
        services: {
          include: {
            service: {
              select: {
                id: true,
                name: true,
              },
            },
            staff: {
              select: {
                id: true,
                name: true,
                jobRole: true,
              },
            },
          },
        },
      },
    });
  },

  findAll: async () => {
    return prisma.appointment.findMany({
      include: {
        salon: {
          select: {
            id: true,
            name: true,
          },
        },
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            customerCode: true,
          },
        },
        staff: {
          select: {
            id: true,
            name: true,
            jobRole: true,
          },
        },
        services: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: {
        startTime: "asc",
      },
    });
  },

  findBySalon: async (
    salonId: string,
    filters?: {
      branchId?: string;
      staffId?: string;
      customerId?: string;
      status?: AppointmentStatus;
      dateFrom?: Date;
      dateTo?: Date;
    }
  ) => {
    return prisma.appointment.findMany({
      where: {
        salonId,
        ...(filters?.branchId ? { branchId: filters.branchId } : {}),
        ...(filters?.staffId ? { staffId: filters.staffId } : {}),
        ...(filters?.customerId ? { customerId: filters.customerId } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.dateFrom && filters?.dateTo
          ? {
              startTime: {
                gte: filters.dateFrom,
                lt: filters.dateTo,
              },
            }
          : {}),
      },
      include: {
        ...soldProductsInclude,
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            customerCode: true,
          },
        },
        staff: {
          select: {
            id: true,
            name: true,
            jobRole: true,
          },
        },
        services: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: {
        startTime: "asc",
      },
    });
  },

  findById: async (id: string) => {
    return prisma.appointment.findUnique({
      where: {
        id,
      },
      include: {
        ...soldProductsInclude,
        salon: {
          select: {
            id: true,
            name: true,
          },
        },
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            customerCode: true,
            outstandingAmount: true,
            walletBalance: true,
          },
        },
        staff: {
          select: {
            id: true,
            name: true,
            jobRole: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        services: {
          include: {
            service: {
              select: {
                id: true,
                name: true,
              },
            },
            staff: {
              select: {
                id: true,
                name: true,
                jobRole: true,
              },
            },
          },
        },
      },
    });
  },

  findByIdAndSalon: async (
    id: string,
    salonId: string,
    branchId?: string
  ) => {
    return prisma.appointment.findFirst({
      where: {
        id,
        salonId,
        ...(branchId ? { branchId } : {}),
      },
      include: {
        ...soldProductsInclude,
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            customerCode: true,
            outstandingAmount: true,
            walletBalance: true,
          },
        },
        staff: {
          select: {
            id: true,
            name: true,
            jobRole: true,
          },
        },
        services: {
          include: {
            service: {
              select: {
                id: true,
                name: true,
              },
            },
            staff: {
              select: {
                id: true,
                name: true,
                jobRole: true,
              },
            },
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });
  },

  findConflict: async (data: {
  staffId: string;
  startTime: Date;
  endTime: Date;
  excludeAppointmentId?: string;
   }) => {
  return prisma.appointment.findFirst({
    where: {
      staffId: data.staffId,
      status: {
        notIn: ["CANCELLED", "NO_SHOW"],
      },
      startTime: {
        lt: data.endTime,
      },
      endTime: {
        gt: data.startTime,
      },
      ...(data.excludeAppointmentId
        ? {
            id: {
              not: data.excludeAppointmentId,
            },
          }
        : {}),
    },
  });
 },

  updateStatus: async (id: string, status: AppointmentStatus) => {
    return prisma.appointment.update({
      where: {
        id,
      },
      data: {
        status,
      },
    });
  },

  updateBasicDetails: async (
    id: string,
    data: {
      bookingNote?: string | null;
      internalNote?: string | null;
      status?: AppointmentStatus;
    }
  , tx?: TransactionClient) => {
    return (tx ?? prisma).appointment.update({
      where: {
        id,
      },
      data,
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        staff: {
          select: {
            id: true,
            name: true,
            jobRole: true,
          },
        },
        services: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });
  },

  delete: async (id: string, tx?: TransactionClient) => {
    return (tx ?? prisma).appointment.delete({
      where: {
        id,
      },
    });
  },
 updateSchedule: async (
  id: string,
  data: {
    startTime: Date;
    endTime: Date;
  },
  tx?: TransactionClient
) => {
  return (tx ?? prisma).appointment.update({
    where: {
      id,
    },
    data: {
      startTime: data.startTime,
      endTime: data.endTime,
    },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          customerCode: true,
        },
      },
      staff: {
        select: {
          id: true,
          name: true,
          jobRole: true,
        },
      },
      branch: {
        select: {
          id: true,
          name: true,
        },
      },
      services: {
        include: {
          service: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      },
    },
  });
},
findInvoiceSourceById: async (id: string) => {
  return prisma.appointment.findUnique({
    where: { id },
    include: {
      salon: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          country: true,
          postalCode: true,
          timezone: true,
          gstEnabled: true,
          gstNumber: true,
          gstLegalName: true,
          gstStateCode: true,
          serviceGstRate: true,
          productGstRate: true,
        },
      },
      branch: {
        select: {
          id: true,
          name: true,
          addressLine1: true,
          city: true,
          state: true,
          postalCode: true,
          phone: true,
        },
      },
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          gst: true,
          loyaltyPoints: true,
          membership: {
            select: {
              id: true,
              name: true,
              discountPercentage: true,
              status: true,
            },
          },
        },
      },
      services: true,
    },
  });
},

findInvoiceSourceByIdAndSalon: async (id: string, salonId: string) => {
  return prisma.appointment.findFirst({
    where: {
      id,
      salonId,
    },
    include: {
      salon: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          country: true,
          postalCode: true,
          timezone: true,
          gstEnabled: true,
          gstNumber: true,
          gstLegalName: true,
          gstStateCode: true,
          serviceGstRate: true,
          productGstRate: true,
        },
      },
      branch: {
        select: {
          id: true,
          name: true,
          addressLine1: true,
          city: true,
          state: true,
          postalCode: true,
          phone: true,
        },
      },
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          gst: true,
          loyaltyPoints: true,
          membership: {
            select: {
              id: true,
              name: true,
              discountPercentage: true,
              status: true,
            },
          },
        },
      },
      services: true,
    },
  });
},
createStatusHistory: async (data: {
  appointmentId: string;
  oldStatus?: AppointmentStatus;
  newStatus: AppointmentStatus;
  note?: string;
  changedById?: string;
}) => {
  return prisma.appointmentStatusHistory.create({
    data: {
      appointmentId: data.appointmentId,
      ...(data.oldStatus ? { oldStatus: data.oldStatus } : {}),
      newStatus: data.newStatus,
      ...(data.note ? { note: data.note } : {}),
      ...(data.changedById ? { changedById: data.changedById } : {}),
    },
  });
},

updateStatusWithHistory: async (
  id: string,
  data: {
    oldStatus: AppointmentStatus;
    newStatus: AppointmentStatus;
    note?: string;
    changedById?: string;
  },
  tx?: TransactionClient
) => {
  const run = async (client: TransactionClient) => {
    await client.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Appointment"
      WHERE "id" = ${id}
      FOR UPDATE
    `;

    const currentAppointment = await client.appointment.findUnique({
      where: { id },
      select: {
        id: true,
        salonId: true,
        branchId: true,
        status: true,
        services: {
          select: { serviceId: true },
        },
      },
    });

    if (!currentAppointment) {
      throw transactionError("Appointment not found", 404);
    }

    if (currentAppointment.status !== data.oldStatus) {
      throw transactionError(
        currentAppointment.status === data.newStatus
          ? "Appointment already has this status"
          : "Appointment status changed; refresh and try again"
      );
    }

    if (data.newStatus === "COMPLETED") {
      const serviceCounts = new Map<string, number>();
      for (const appointmentService of currentAppointment.services) {
        serviceCounts.set(
          appointmentService.serviceId,
          (serviceCounts.get(appointmentService.serviceId) ?? 0) + 1
        );
      }

      const consumables = serviceCounts.size
        ? await client.serviceConsumable.findMany({
            where: {
              salonId: currentAppointment.salonId,
              serviceId: { in: [...serviceCounts.keys()] },
              status: true,
            },
          })
        : [];
      const quantitiesByProduct = new Map<string, Prisma.Decimal>();

      for (const consumable of consumables) {
        const serviceQuantity = serviceCounts.get(consumable.serviceId) ?? 1;
        const quantity = consumable.quantity.mul(serviceQuantity);
        quantitiesByProduct.set(
          consumable.productId,
          (quantitiesByProduct.get(consumable.productId) ??
            new Prisma.Decimal(0)).add(quantity)
        );
      }

      for (const [productId, quantity] of [...quantitiesByProduct.entries()].sort(
        ([left], [right]) => left.localeCompare(right)
      )) {
        try {
          await createStockMovement({
            tx: client,
            salonId: currentAppointment.salonId,
            ...(currentAppointment.branchId
              ? { branchId: currentAppointment.branchId }
              : {}),
            productId,
            type: "USED_IN_SERVICE",
            quantity,
            referenceType: "APPOINTMENT",
            referenceId: currentAppointment.id,
            reason: "Used in completed appointment",
            ...(data.changedById ? { createdById: data.changedById } : {}),
          });
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.toLowerCase().includes("insufficient stock")
          ) {
            throw transactionError(
              "Insufficient stock for service consumables"
            );
          }
          throw error;
        }
      }
    }

    const appointment = await client.appointment.update({
      where: {
        id,
      },
      data: {
        status: data.newStatus,
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            customerCode: true,
          },
        },
        staff: {
          select: {
            id: true,
            name: true,
            jobRole: true,
          },
        },
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
        services: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        statusHistory: {
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });

    await client.appointmentStatusHistory.create({
      data: {
        appointmentId: id,
        oldStatus: data.oldStatus,
        newStatus: data.newStatus,
        ...(data.note ? { note: data.note } : {}),
        ...(data.changedById ? { changedById: data.changedById } : {}),
      },
    });

    return appointment;
  };
  return tx ? run(tx) : prisma.$transaction(run);
},

findStatusHistory: async (appointmentId: string) => {
  return prisma.appointmentStatusHistory.findMany({
    where: {
      appointmentId,
    },
    include: {
      changedBy: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });
},
};
