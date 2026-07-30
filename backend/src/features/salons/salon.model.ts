import { prisma } from "../../config/prisma.js";
import { buildSalonCode } from "../../utils/business-id.js";
import type { Prisma } from "../../generated/prisma/client.js";

export const SalonModel = {
  create: async (data: {
    name: string;
    email?: string;
    phone?: string;
    addressLine1?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    timezone?: string;
  }) => {
    const salonCode = buildSalonCode({
      salonName: data.name,
      timezone: data.timezone,
    });

    return prisma.salon.create({
      data: {
        ...data,
        salonCode,
      },
    });
  },

  findAll: async () => {
    return prisma.salon.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });
  },

  findById: async (id: string) => {
    return prisma.salon.findUnique({
      where: {
        id,
      },
    });
  },

  updateGstSettings: async (
    id: string,
    data: Prisma.SalonUpdateInput,
    tx?: Prisma.TransactionClient
  ) => {
    return (tx ?? prisma).salon.update({
      where: { id },
      data,
    });
  },
};
