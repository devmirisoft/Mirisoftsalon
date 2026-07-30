import { prisma } from "../../config/prisma.js";
const membershipSelect = {
    id: true,
    name: true,
    discountPercentage: true,
    status: true,
};
const membershipHistoryInclude = {
    where: { status: "ACTIVE" },
    include: {
        membership: {
            select: membershipSelect,
        },
    },
    orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
    take: 1,
};
export const CustomerModel = {
    create: async (data) => {
        return prisma.customer.create({
            data,
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
                membership: {
                    select: membershipSelect,
                },
                membershipHistory: membershipHistoryInclude,
            },
        });
    },
    findAll: async () => {
        return prisma.customer.findMany({
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
                membership: {
                    select: membershipSelect,
                },
                membershipHistory: membershipHistoryInclude,
            },
            orderBy: {
                createdAt: "desc",
            },
        });
    },
    findBySalon: async (salonId, branchId) => {
        return prisma.customer.findMany({
            where: {
                salonId,
                ...(branchId ? { branchId } : {}),
            },
            include: {
                branch: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                membership: {
                    select: membershipSelect,
                },
                membershipHistory: membershipHistoryInclude,
            },
            orderBy: {
                createdAt: "desc",
            },
        });
    },
    findById: async (id) => {
        return prisma.customer.findUnique({
            where: {
                id,
            },
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
                membership: {
                    select: membershipSelect,
                },
                membershipHistory: membershipHistoryInclude,
                transactions: {
                    orderBy: {
                        createdAt: "desc",
                    },
                },
            },
        });
    },
    findByIdAndSalon: async (id, salonId, branchId) => {
        return prisma.customer.findFirst({
            where: {
                id,
                salonId,
                ...(branchId ? { branchId } : {}),
            },
            include: {
                branch: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                membership: {
                    select: membershipSelect,
                },
                membershipHistory: membershipHistoryInclude,
                transactions: {
                    orderBy: {
                        createdAt: "desc",
                    },
                },
            },
        });
    },
    findByPhoneAndSalon: async (phone, salonId) => {
        return prisma.customer.findFirst({
            where: {
                phone,
                salonId,
            },
        });
    },
    findByCustomerCodeAndSalon: async (customerCode, salonId) => {
        return prisma.customer.findFirst({
            where: {
                customerCode,
                salonId,
            },
        });
    },
    update: async (id, data) => {
        return prisma.customer.update({
            where: {
                id,
            },
            data,
            include: {
                branch: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                membership: {
                    select: membershipSelect,
                },
                membershipHistory: membershipHistoryInclude,
            },
        });
    },
    assignMembership: async (id, membershipId, tx) => {
        return (tx ?? prisma).customer.update({
            where: {
                id,
            },
            data: {
                membershipId,
            },
            include: {
                membership: {
                    select: {
                        id: true,
                        name: true,
                        discountPercentage: true,
                        status: true,
                    },
                },
                membershipHistory: membershipHistoryInclude,
            },
        });
    },
    delete: async (id) => {
        return prisma.customer.delete({
            where: {
                id,
            },
        });
    },
    findTransactions: async (customerId, salonId) => {
        return prisma.customerTransaction.findMany({
            where: {
                customerId,
                salonId,
            },
            orderBy: {
                createdAt: "asc",
            },
        });
    },
    findByEmailAndSalon: async (email, salonId) => {
        return prisma.customer.findFirst({
            where: {
                email,
                salonId,
            },
        });
    },
    createTransaction: async (data) => {
        return prisma.customerTransaction.create({
            data,
        });
    },
    addWalletAmount: async (customerId, amount) => {
        return prisma.customer.update({
            where: {
                id: customerId,
            },
            data: {
                walletBalance: {
                    increment: amount,
                },
            },
        });
    },
    increaseOutstanding: async (customerId, amount) => {
        return prisma.customer.update({
            where: {
                id: customerId,
            },
            data: {
                outstandingAmount: {
                    increment: amount,
                },
            },
        });
    },
    reduceOutstanding: async (customerId, amount) => {
        return prisma.customer.update({
            where: {
                id: customerId,
            },
            data: {
                outstandingAmount: {
                    decrement: amount,
                },
            },
        });
    },
    increaseOutstandingWithTransaction: async (data, tx) => {
        const run = async (client) => {
            const customer = await client.customer.update({
                where: {
                    id: data.customerId,
                },
                data: {
                    outstandingAmount: {
                        increment: data.amount,
                    },
                },
            });
            const transaction = await client.customerTransaction.create({
                data: {
                    customerId: data.customerId,
                    salonId: data.salonId,
                    invoiceId: data.invoiceId,
                    billNo: data.billNo,
                    narration: data.narration || "Invoice generated",
                    type: "INVOICE",
                    debit: data.amount,
                    credit: 0,
                    balanceAfter: customer.outstandingAmount,
                    status: "COMPLETE",
                },
            });
            return {
                customer,
                transaction,
            };
        };
        return tx ? run(tx) : prisma.$transaction(run);
    },
    decreaseOutstandingWithTransaction: async (data) => {
        return prisma.$transaction(async (tx) => {
            const customer = await tx.customer.update({
                where: {
                    id: data.customerId,
                },
                data: {
                    outstandingAmount: {
                        decrement: data.amount,
                    },
                },
            });
            const transaction = await tx.customerTransaction.create({
                data: {
                    customerId: data.customerId,
                    salonId: data.salonId,
                    invoiceId: data.invoiceId,
                    paymentId: data.paymentId,
                    billNo: data.billNo,
                    narration: data.narration || "Payment received",
                    type: "PAYMENT",
                    debit: 0,
                    credit: data.amount,
                    balanceAfter: Number(customer.outstandingAmount),
                    status: "COMPLETE",
                },
            });
            return {
                customer,
                transaction,
            };
        });
    },
};
