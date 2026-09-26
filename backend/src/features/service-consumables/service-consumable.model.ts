import { prisma } from "../../config/prisma.js";

const include = {
  service: {
    select: {
      id: true,
      name: true,
      branchId: true,
      status: true,
    },
  },
  product: {
    select: {
      id: true,
      name: true,
      unit: true,
      packSize: true,
      packUnit: true,
      branchId: true,
      currentStock: true,
      isServiceConsumable: true,
      status: true,
    },
  },
  salon: {
    select: {
      id: true,
      name: true,
    },
  },
} as const;

export const ServiceConsumableModel = {
  findService: (id: string, salonId?: string, branchId?: string) =>
    prisma.service.findFirst({
      where: {
        id,
        ...(salonId ? { salonId } : {}),
        ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
      },
    }),

  findProduct: (id: string, salonId: string) =>
    prisma.product.findFirst({
      where: { id, salonId },
    }),

  find: (id: string, salonId?: string) =>
    prisma.serviceConsumable.findFirst({
      where: {
        id,
        ...(salonId ? { salonId } : {}),
      },
      include,
    }),

  findByServiceAndProduct: (
    salonId: string,
    serviceId: string,
    productId: string
  ) =>
    prisma.serviceConsumable.findUnique({
      where: {
        salonId_serviceId_productId: {
          salonId,
          serviceId,
          productId,
        },
      },
      include,
    }),

  listActive: (serviceId: string, salonId: string) =>
    prisma.serviceConsumable.findMany({
      where: {
        serviceId,
        salonId,
        status: true,
      },
      include,
      orderBy: { createdAt: "asc" },
    }),

  create: (data: {
    salonId: string;
    serviceId: string;
    productId: string;
    quantity: number;
  }) => prisma.serviceConsumable.create({ data, include }),

  update: (
    id: string,
    data: {
      productId?: string;
      quantity?: number;
      status?: boolean;
    }
  ) => prisma.serviceConsumable.update({ where: { id }, data, include }),
};
