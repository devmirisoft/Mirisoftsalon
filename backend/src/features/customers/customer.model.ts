import { prisma } from "../../config/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";

type CustomerStatus = "REGULAR" | "PREMIUM" | "IRREGULAR";
type TransactionStatus = "PENDING" | "COMPLETE" | "FAILED";

const membershipSelect = {
  id: true,
  name: true,
  discountPercentage: true,
  status: true,
} as const;

const membershipHistoryInclude = {
  where: { status: "ACTIVE" },
  include: {
    membership: {
      select: membershipSelect,
    },
  },
  orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
  take: 1,
} satisfies Prisma.Customer$membershipHistoryArgs;

export const CustomerModel = {
  create: async (data: {
    customerCode: string;
    name: string;
    phone: string;
    email?: string;
    gst?: string;
    customNotes?: string;
    dob?: Date;
    anniversaryDate?: Date;
    status?: CustomerStatus;
    salonId: string;
    branchId?: string;
  }) => {
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

  findBySalon: async (salonId: string, branchId?: string) => {
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

  findById: async (id: string) => {
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

  findByIdAndSalon: async (
    id: string,
    salonId: string,
    branchId?: string
  ) => {
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

  findByPhoneAndSalon: async (phone: string, salonId: string) => {
    return prisma.customer.findFirst({
      where: {
        phone,
        salonId,
      },
    });
  },

  findByCustomerCodeAndSalon: async (
    customerCode: string,
    salonId: string
  ) => {
    return prisma.customer.findFirst({
      where: {
        customerCode,
        salonId,
      },
    });
  },

  update: async (
    id: string,
    data: {
      name?: string;
      phone?: string;
      email?: string | null;
      gst?: string | null;
      customNotes?: string | null;
      dob?: Date | null;
      anniversaryDate?: Date | null;
      status?: CustomerStatus;
      branchId?: string | null;
    }
  ) => {
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

  assignMembership: async (
    id: string,
    membershipId: string | null,
    tx?: Prisma.TransactionClient
  ) => {
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

  delete: async (id: string) => {
    return prisma.customer.delete({
      where: {
        id,
      },
    });
  },

  findTransactions: async (customerId: string, salonId: string) => {
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

  findByEmailAndSalon: async (email: string, salonId: string) => {
    return prisma.customer.findFirst({
      where: {
        email,
        salonId,
      },
    });
  },

  createTransaction: async (data: {
    customerId: string;
    salonId: string;
    billNo?: string;
    narration: string;
    debit?: number;
    credit?: number;
    status?: TransactionStatus;
  }) => {
    return prisma.customerTransaction.create({
      data,
    });
  },

  addWalletAmount: async (
    customerId: string,
    amount: number
  ) => {
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

  increaseOutstanding: async (
    customerId: string,
    amount: number
  ) => {
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

  reduceOutstanding: async (
    customerId: string,
    amount: number
  ) => {
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
  increaseOutstandingWithTransaction: async (data: {
  customerId: string;
  salonId: string;
  invoiceId: string;
  billNo: string;
  amount: number | Prisma.Decimal;
  narration?: string;
}, tx?: Prisma.TransactionClient) => {
  const run = async (client: Prisma.TransactionClient) => {
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

decreaseOutstandingWithTransaction: async (data: {
  customerId: string;
  salonId: string;
  invoiceId: string;
  paymentId: string;
  billNo: string;
  amount: number;
  narration?: string;
}) => {
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
