import { prisma } from "../../config/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";

const activeSalaryConfig = {
  salaryConfigs: {
    where: { status: true },
    orderBy: { effectiveFrom: "desc" },
    take: 1,
  },
} as const;

export const StaffModel = {
  create: async (data: {
    staffCode: string;
    name: string;
    email: string;
    phone: string;
    jobRole: string;
    workingFrom: string;
    workingTo: string;
    weekOff: string;
    joiningDate: Date;
    salonId: string;
    branchId?: string;
    reportingManagerId?: string;
  }, tx?: Prisma.TransactionClient) => {
    return (tx ?? prisma).staff.create({
      data,
      include: {
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
        reportingManager: {
          select: {
            id: true,
            name: true,
            jobRole: true,
          },
        },
      },
    });
  },

  findByStaffCode: async (staffCode: string, salonId: string) => {
    return prisma.staff.findFirst({
      where: {
        staffCode,
        salonId,
      },
    });
  },

  findBySalon: async (salonId: string, branchId?: string) => {
    return prisma.staff.findMany({
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
        reportingManager: {
          select: {
            id: true,
            name: true,
            jobRole: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  },

  findAll: async () => {
    return prisma.staff.findMany({
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
        reportingManager: {
          select: {
            id: true,
            name: true,
            jobRole: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  },
  findById: async (id: string) => {
  return prisma.staff.findUnique({
    where: { id },
    include: {
      ...activeSalaryConfig,
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
      reportingManager: {
        select: {
          id: true,
          name: true,
          jobRole: true,
        },
      },
    },
  });
},

findByIdAndSalon: async (id: string, salonId: string, branchId?: string) => {
  return prisma.staff.findFirst({
    where: {
      id,
      salonId,
      ...(branchId ? { branchId } : {}),
    },
    include: {
      ...activeSalaryConfig,
      branch: {
        select: {
          id: true,
          name: true,
        },
      },
      reportingManager: {
        select: {
          id: true,
          name: true,
          jobRole: true,
        },
      },
    },
  });
},

update: async (
  id: string,
  data: {
    name?: string;
    email?: string;
    phone?: string;
    jobRole?: string;
    workingFrom?: string;
    workingTo?: string;
    weekOff?: string;
    branchId?: string | null;
    reportingManagerId?: string | null;
  },
  tx?: Prisma.TransactionClient
) => {
  return (tx ?? prisma).staff.update({
    where: { id },
    data,
  });
},

updateStatus: async (id: string, status: boolean) => {
  return prisma.staff.update({
    where: { id },
    data: { status },
  });
},

delete: async (id: string) => {
  return prisma.staff.delete({
    where: { id },
  });
},
};
