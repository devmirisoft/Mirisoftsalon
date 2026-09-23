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
    createStaffAccount: async (data, tx) => {
        const { staffId, ...userData } = data;
        const run = async (client) => {
            const user = await client.user.create({
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
            await client.staff.update({
                where: { id: staffId },
                data: { userId: user.id },
            });
            return user;
        };
        // Called inside the staff-create transaction so a failed login rolls the
        // staff row back too; standalone it opens its own.
        return tx ? run(tx) : prisma.$transaction(run);
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
