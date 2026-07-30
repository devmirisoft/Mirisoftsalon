import { prisma } from "../../config/prisma.js";
import { buildSalonCode } from "../../utils/business-id.js";
export const SalonModel = {
    create: async (data) => {
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
    findById: async (id) => {
        return prisma.salon.findUnique({
            where: {
                id,
            },
        });
    },
    updateGstSettings: async (id, data, tx) => {
        return (tx ?? prisma).salon.update({
            where: { id },
            data,
        });
    },
};
