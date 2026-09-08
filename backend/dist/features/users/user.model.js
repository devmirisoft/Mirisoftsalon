import { prisma } from "../../config/prisma.js";
export const UserModel = {
    findByEmail: async (email) => {
        return prisma.user.findUnique({
            where: { email }
        });
    },
    createSalonAdmin: async (data) => {
        return prisma.user.create({
            data: {
                ...data,
                role: "SALON_ADMIN",
            },
            select: {
                id: true,
                name: true,
                email: true,
                phone_number: true,
                role: true,
                status: true,
                salonId: true,
                branchId: true,
                createdAt: true,
            },
        });
    },
    createStaffAccount: async (data) => {
        const { staffId, ...userData } = data;
        return prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    ...userData,
                    role: "STAFF",
                },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    phone_number: true,
                    role: true,
                    status: true,
                    salonId: true,
                    branchId: true,
                    createdAt: true,
                },
            });
            await tx.staff.update({
                where: { id: staffId },
                data: { userId: user.id },
            });
            return user;
        });
    },
    findByPhoneNumber: async (phone_number) => {
        return prisma.user.findUnique({
            where: { phone_number },
        });
    },
    create: async (data) => {
        return prisma.user.create({
            data,
            select: {
                id: true,
                name: true,
                email: true,
                phone_number: true,
                role: true,
                status: true,
                salonId: true,
                branchId: true,
                createdAt: true,
            },
        });
    },
    findById: async (id) => {
        return prisma.user.findUnique({ where: { id } });
    },
    updateStatus: async (id, status) => {
        return prisma.user.update({
            where: { id },
            data: { status },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                status: true,
                salonId: true,
                branchId: true,
                updatedAt: true,
            },
        });
    },
};
