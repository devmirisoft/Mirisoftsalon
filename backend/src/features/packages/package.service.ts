import { prisma } from "../../config/prisma.js";
import {
  Prisma,
  type CustomerPackageStatus,
  type PackageStatus,
  type ServicePackageType,
} from "../../generated/prisma/client.js";
import { createAuditLog } from "../audit-logs/audit-log.service.js";
import { resolveCurrentCustomerMembership } from "../customer-memberships/customer-membership.service.js";

type TransactionClient = Prisma.TransactionClient;

export type PackageActor = {
  userId: string;
  role: string;
  salonId?: string;
  branchId?: string;
};

type AuditContext = { ipAddress?: string; userAgent?: string };

export class PackageError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "PackageError";
  }
}

const branchRoles = new Set(["BRANCH_MANAGER", "RECEPTIONIST"]);

const scope = (actor: PackageActor) => {
  if (actor.role === "SUPER_ADMIN") return {};
  if (!actor.salonId) return { salonId: "__unauthorized__" };
  return {
    salonId: actor.salonId,
    ...(branchRoles.has(actor.role)
      ? { OR: [{ branchId: null }, { branchId: actor.branchId ?? "__unauthorized__" }] }
      : {}),
  };
};

const managementScope = (actor: PackageActor) => {
  if (actor.role === "SUPER_ADMIN") return {};
  if (!actor.salonId) return { salonId: "__unauthorized__" };
  return {
    salonId: actor.salonId,
    ...(actor.role === "BRANCH_MANAGER"
      ? { branchId: actor.branchId ?? "__unauthorized__" }
      : {}),
  };
};

const customerPackageScope = (actor: PackageActor) => {
  if (actor.role === "SUPER_ADMIN") return {};
  if (!actor.salonId) return { salonId: "__unauthorized__" };
  return {
    salonId: actor.salonId,
    ...(branchRoles.has(actor.role)
      ? { branchId: actor.branchId ?? "__unauthorized__" }
      : {}),
  };
};

const writeScope = (
  actor: PackageActor,
  requestedSalonId?: string,
  requestedBranchId?: string | null
) => {
  const salonId =
    actor.role === "SUPER_ADMIN" ? requestedSalonId : actor.salonId;
  if (!salonId) throw new PackageError(400, "Salon is required");
  const branchId =
    actor.role === "BRANCH_MANAGER" ? actor.branchId : requestedBranchId;
  if (actor.role === "BRANCH_MANAGER" && !branchId) {
    throw new PackageError(400, "Branch is required");
  }
  return { salonId, branchId: branchId ?? null };
};

const assertBranch = async (
  tx: TransactionClient,
  salonId: string,
  branchId: string | null
) => {
  if (!branchId) return;
  const branch = await tx.branch.findFirst({
    where: { id: branchId, salonId, status: true },
    select: { id: true },
  });
  if (!branch) throw new PackageError(400, "Invalid branch");
};

const categoryInclude = {
  branch: { select: { id: true, name: true } },
  _count: { select: { packages: true } },
} as const;

const packageInclude = {
  category: { select: { id: true, name: true, status: true } },
  branch: { select: { id: true, name: true } },
  customer: { select: { id: true, name: true, phone: true } },
  sourceCustomer: { select: { id: true, name: true, phone: true } },
  sourcePackage: { select: { id: true, name: true } },
  items: {
    include: {
      service: {
        select: {
          id: true,
          name: true,
          status: true,
          branchId: true,
          price: true,
        },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
  _count: { select: { customerPackages: true, invoiceItems: true } },
} as const;

const normalizeItems = (
  items?: Array<{ serviceId: string; quantity: number }>,
  serviceIds?: string[]
) =>
  items?.length
    ? items
    : (serviceIds ?? []).map((serviceId) => ({ serviceId, quantity: 1 }));

const serviceDurationMinutes = (service: {
  durationValue: number | null;
  durationUnit: "MINUTES" | "HOURS";
}) =>
  service.durationValue === null
    ? null
    : service.durationValue * (service.durationUnit === "HOURS" ? 60 : 1);

const customCategoryName = "Customer Custom Packages";

const ensureCustomPackageCategory = async (
  tx: TransactionClient,
  salonId: string
) => {
  const existing = await tx.packageCategory.findFirst({
    where: {
      salonId,
      name: { equals: customCategoryName, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (existing) return existing;
  return tx.packageCategory.create({
    data: {
      salonId,
      branchId: null,
      name: customCategoryName,
      status: "ACTIVE",
    },
    select: { id: true },
  });
};

const assertCustomer = async (
  tx: TransactionClient,
  actor: PackageActor,
  customerId: string,
  salonId: string,
  branchId?: string | null
) => {
  const customer = await tx.customer.findFirst({
    where: {
      id: customerId,
      salonId,
      ...(branchRoles.has(actor.role)
        ? { branchId: actor.branchId ?? "__unauthorized__" }
        : {}),
      ...(branchId ? { OR: [{ branchId: null }, { branchId }] } : {}),
    },
    select: { id: true, name: true, phone: true },
  });
  if (!customer) throw new PackageError(404, "Customer not found");
  return customer;
};

const uniquePackageName = async (
  tx: TransactionClient,
  salonId: string,
  requestedName: string
) => {
  const base = requestedName.trim().slice(0, 110) || "Custom Package";
  let candidate = base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const existing = await tx.servicePackage.findFirst({
      where: {
        salonId,
        name: { equals: candidate, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (!existing) return candidate;
    candidate = `${base} (${suffix})`.slice(0, 120);
  }
  throw new PackageError(409, "Package name already exists in this salon");
};

const resolvePackageItems = async (
  tx: TransactionClient,
  salonId: string,
  branchId: string | null,
  rawItems: Array<{ serviceId: string; quantity: number }>
) => {
  const ids = rawItems.map((item) => item.serviceId);
  if (new Set(ids).size !== ids.length) {
    throw new PackageError(400, "Duplicate services are not allowed");
  }
  const services = await tx.service.findMany({
    where: {
      id: { in: ids },
      salonId,
      status: true,
      ...(branchId ? { OR: [{ branchId: null }, { branchId }] } : {}),
    },
  });
  if (services.length !== ids.length) {
    throw new PackageError(
      400,
      "Services must belong to the package salon and branch"
    );
  }
  const byId = new Map(services.map((service) => [service.id, service]));
  const items = rawItems.map((item) => ({
    service: byId.get(item.serviceId)!,
    quantity: item.quantity,
  }));
  const totalPrice = items.reduce(
    (total, item) =>
      total.add(item.service.price.mul(item.quantity)),
    new Prisma.Decimal(0)
  );
  return { items, totalPrice: totalPrice.toDecimalPlaces(2) };
};

export const listPackageCategories = async (
  actor: PackageActor,
  filters: {
    page: number;
    limit: number;
    search?: string | undefined;
    status?: PackageStatus | undefined;
    salonId?: string | undefined;
    branchId?: string | undefined;
  }
) => {
  const where: Prisma.PackageCategoryWhereInput = {
    ...scope(actor),
    ...(actor.role === "SUPER_ADMIN" && filters.salonId
      ? { salonId: filters.salonId }
      : {}),
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.search
      ? { name: { contains: filters.search, mode: "insensitive" } }
      : {}),
    ...(actor.role === "RECEPTIONIST" ? { status: "ACTIVE" } : {}),
  };
  const [total, data] = await Promise.all([
    prisma.packageCategory.count({ where }),
    prisma.packageCategory.findMany({
      where,
      include: categoryInclude,
      orderBy: { name: "asc" },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    }),
  ]);
  return {
    data,
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / filters.limit)),
    },
  };
};

export const getPackageCategory = async (
  actor: PackageActor,
  id: string
) => {
  const data = await prisma.packageCategory.findFirst({
    where: {
      id,
      ...scope(actor),
      ...(actor.role === "RECEPTIONIST" ? { status: "ACTIVE" } : {}),
    },
    include: categoryInclude,
  });
  if (!data) throw new PackageError(404, "Package category not found");
  return data;
};

export const createPackageCategory = async (
  actor: PackageActor,
  input: {
    salonId?: string | undefined;
    branchId?: string | null | undefined;
    name: string;
    status?: PackageStatus | undefined;
  },
  audit: AuditContext
) =>
  prisma.$transaction(async (tx) => {
    const target = writeScope(actor, input.salonId, input.branchId);
    await assertBranch(tx, target.salonId, target.branchId);
    const duplicate = await tx.packageCategory.findFirst({
      where: {
        salonId: target.salonId,
        name: { equals: input.name, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new PackageError(
        409,
        "Package category name already exists in this salon"
      );
    }
    const created = await tx.packageCategory.create({
      data: {
        salonId: target.salonId,
        branchId: target.branchId,
        name: input.name,
        status: input.status ?? "ACTIVE",
        createdById: actor.userId,
      },
      include: categoryInclude,
    });
    await createAuditLog({
      tx,
      salonId: created.salonId,
      branchId: created.branchId,
      userId: actor.userId,
      module: "PACKAGE",
      action: "CREATE",
      entityId: created.id,
      entityName: created.name,
      description: `Package category ${created.name} created`,
      newData: created,
      ...audit,
    });
    return created;
  });

export const updatePackageCategory = async (
  actor: PackageActor,
  id: string,
  input: {
    branchId?: string | null | undefined;
    name: string;
    status?: PackageStatus | undefined;
  },
  audit: AuditContext
) =>
  prisma.$transaction(async (tx) => {
    const existing = await tx.packageCategory.findFirst({
      where: { id, ...managementScope(actor) },
      include: categoryInclude,
    });
    if (!existing) throw new PackageError(404, "Package category not found");
    const branchId =
      actor.role === "BRANCH_MANAGER"
        ? actor.branchId ?? null
        : input.branchId === undefined
          ? existing.branchId
          : input.branchId;
    await assertBranch(tx, existing.salonId, branchId);
    const duplicate = await tx.packageCategory.findFirst({
      where: {
        salonId: existing.salonId,
        id: { not: id },
        name: { equals: input.name, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new PackageError(
        409,
        "Package category name already exists in this salon"
      );
    }
    const updated = await tx.packageCategory.update({
      where: { id },
      data: {
        name: input.name,
        branchId,
        ...(input.status ? { status: input.status } : {}),
      },
      include: categoryInclude,
    });
    await createAuditLog({
      tx,
      salonId: existing.salonId,
      branchId: updated.branchId,
      userId: actor.userId,
      module: "PACKAGE",
      action: "UPDATE",
      entityId: id,
      entityName: updated.name,
      description: `Package category ${updated.name} updated`,
      oldData: existing,
      newData: updated,
      ...audit,
    });
    return updated;
  });

export const setPackageCategoryStatus = async (
  actor: PackageActor,
  id: string,
  status: PackageStatus,
  audit: AuditContext
) =>
  prisma.$transaction(async (tx) => {
    const existing = await tx.packageCategory.findFirst({
      where: { id, ...managementScope(actor) },
    });
    if (!existing) throw new PackageError(404, "Package category not found");
    const updated = await tx.packageCategory.update({
      where: { id },
      data: { status },
      include: categoryInclude,
    });
    await createAuditLog({
      tx,
      salonId: existing.salonId,
      branchId: existing.branchId,
      userId: actor.userId,
      module: "PACKAGE",
      action: "STATUS_CHANGE",
      entityId: id,
      entityName: existing.name,
      description: `Package category ${existing.name} ${status.toLowerCase()}`,
      oldData: { status: existing.status },
      newData: { status },
      ...audit,
    });
    return updated;
  });

export const deletePackageCategory = async (
  actor: PackageActor,
  id: string,
  audit: AuditContext
) =>
  prisma.$transaction(async (tx) => {
    const existing = await tx.packageCategory.findFirst({
      where: { id, ...managementScope(actor) },
      include: categoryInclude,
    });
    if (!existing) throw new PackageError(404, "Package category not found");
    const softDeleted = existing._count.packages > 0;
    if (softDeleted) {
      await tx.packageCategory.update({
        where: { id },
        data: { status: "INACTIVE" },
      });
    } else {
      await tx.packageCategory.delete({ where: { id } });
    }
    await createAuditLog({
      tx,
      salonId: existing.salonId,
      branchId: existing.branchId,
      userId: actor.userId,
      module: "PACKAGE",
      action: "DELETE",
      entityId: id,
      entityName: existing.name,
      description: `Package category ${existing.name} ${softDeleted ? "deactivated" : "deleted"}`,
      oldData: existing,
      ...audit,
    });
    return { softDeleted };
  });

export const listServicePackages = async (
  actor: PackageActor,
  filters: {
    page: number;
    limit: number;
    search?: string | undefined;
    status?: PackageStatus | undefined;
    type?: ServicePackageType | undefined;
    categoryId?: string | undefined;
    customerId?: string | undefined;
    salonId?: string | undefined;
    branchId?: string | undefined;
  }
) => {
  const where: Prisma.ServicePackageWhereInput = {
    ...scope(actor),
    ...(actor.role === "SUPER_ADMIN" && filters.salonId
      ? { salonId: filters.salonId }
      : {}),
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.search
      ? {
          OR: [
            { name: { contains: filters.search, mode: "insensitive" } },
            {
              description: {
                contains: filters.search,
                mode: "insensitive",
              },
            },
          ],
        }
      : {}),
    ...(actor.role === "RECEPTIONIST" ? { status: "ACTIVE" } : {}),
  };
  const [total, data] = await Promise.all([
    prisma.servicePackage.count({ where }),
    prisma.servicePackage.findMany({
      where,
      include: packageInclude,
      orderBy: { name: "asc" },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    }),
  ]);
  return {
    data,
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / filters.limit)),
    },
  };
};

export const getServicePackage = async (actor: PackageActor, id: string) => {
  const data = await prisma.servicePackage.findFirst({
    where: {
      id,
      ...scope(actor),
      ...(actor.role === "RECEPTIONIST" ? { status: "ACTIVE" } : {}),
    },
    include: packageInclude,
  });
  if (!data) throw new PackageError(404, "Package not found");
  return data;
};

export const createServicePackage = async (
  actor: PackageActor,
  input: {
    salonId?: string | undefined;
    branchId?: string | null | undefined;
    categoryId: string;
    name: string;
    description?: string | null | undefined;
    specialPrice: number;
    validityDays: number;
    status?: PackageStatus | undefined;
    items?: Array<{ serviceId: string; quantity: number }> | undefined;
    serviceIds?: string[] | undefined;
  },
  audit: AuditContext
) =>
  prisma.$transaction(async (tx) => {
    const target = writeScope(actor, input.salonId, input.branchId);
    await assertBranch(tx, target.salonId, target.branchId);
    const category = await tx.packageCategory.findFirst({
      where: {
        id: input.categoryId,
        salonId: target.salonId,
        status: "ACTIVE",
        ...(target.branchId
          ? { OR: [{ branchId: null }, { branchId: target.branchId }] }
          : {}),
      },
    });
    if (!category) throw new PackageError(400, "Invalid package category");
    const duplicate = await tx.servicePackage.findFirst({
      where: {
        salonId: target.salonId,
        name: { equals: input.name, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new PackageError(409, "Package name already exists in this salon");
    }
    const resolved = await resolvePackageItems(
      tx,
      target.salonId,
      target.branchId,
      normalizeItems(input.items, input.serviceIds)
    );
    if (new Prisma.Decimal(input.specialPrice).gt(resolved.totalPrice)) {
      throw new PackageError(
        400,
        "Special price cannot exceed total price"
      );
    }
    const created = await tx.servicePackage.create({
      data: {
        salonId: target.salonId,
        branchId: target.branchId,
        categoryId: category.id,
        type: "STANDARD",
        name: input.name,
        description: input.description ?? null,
        totalPrice: resolved.totalPrice,
        specialPrice: input.specialPrice,
        validityDays: input.validityDays,
        status: input.status ?? "ACTIVE",
        createdById: actor.userId,
        items: {
          create: resolved.items.map(({ service, quantity }) => ({
            salonId: target.salonId,
            serviceId: service.id,
            serviceNameSnapshot: service.name,
            quantity,
            priceSnapshot: service.price,
            durationMinutesSnapshot: serviceDurationMinutes(service),
          })),
        },
      },
      include: packageInclude,
    });
    await createAuditLog({
      tx,
      salonId: created.salonId,
      branchId: created.branchId,
      userId: actor.userId,
      module: "PACKAGE",
      action: "CREATE",
      entityId: created.id,
      entityName: created.name,
      description: `Package ${created.name} created`,
      newData: created,
      ...audit,
    });
    return created;
  });

export const createCustomPackageFromCart = async (
  actor: PackageActor,
  input: {
    jobCartId: string;
    serviceIds?: string[] | undefined;
    items?: Array<{ serviceId: string; quantity: number }> | undefined;
    name: string;
    description?: string | null | undefined;
    specialPrice: number;
    validityDays: number;
    soldByStaffId?: string | undefined;
  },
  audit: AuditContext
) =>
  prisma.$transaction(async (tx) => {
    const requestedItems = normalizeItems(input.items, input.serviceIds);
    const requestedServiceIds = requestedItems.map((item) => item.serviceId);
    await tx.$queryRaw`SELECT "id" FROM "Appointment" WHERE "id" = ${input.jobCartId} FOR UPDATE`;
    const cart = await tx.appointment.findFirst({
      where: {
        id: input.jobCartId,
        walkInJobCart: true,
        source: "WALK_IN",
        ...(actor.role === "SUPER_ADMIN"
          ? {}
          : { salonId: actor.salonId ?? "__unauthorized__" }),
        ...(branchRoles.has(actor.role)
          ? { branchId: actor.branchId ?? "__unauthorized__" }
          : {}),
      },
      include: {
        customer: { select: { id: true, name: true } },
        services: {
          where: {
            customerPackageUsageItemId: null,
            serviceId: { in: requestedServiceIds },
          },
          include: { service: true },
        },
        invoice: { include: { items: true } },
      },
    });
    if (!cart || !cart.branchId) {
      throw new PackageError(404, "Job cart not found");
    }
    if (
      cart.status === "CANCELLED" ||
      cart.invoice?.status !== "DRAFT" ||
      cart.invoice.paymentStatus !== "UNPAID" ||
      cart.invoice.paidAmount.gt(0)
    ) {
      throw new PackageError(409, "Job cart cannot be changed");
    }
    if (cart.invoice.couponId) {
      throw new PackageError(
        409,
        "Remove the coupon before creating a custom package"
      );
    }
    if (cart.services.length !== requestedServiceIds.length) {
      throw new PackageError(
        400,
        "Custom package services must already be standalone services in this job cart"
      );
    }
    const invoicePackages = cart.invoice.items.filter(
      (item) => item.itemType === "PACKAGE" && item.packageId
    );
    if (invoicePackages.length) {
      const packageItems = await tx.servicePackageItem.findMany({
        where: {
          packageId: {
            in: invoicePackages
              .map((item) => item.packageId)
              .filter((id): id is string => Boolean(id)),
          },
          serviceId: { in: requestedServiceIds },
        },
        select: { serviceNameSnapshot: true },
      });
      if (packageItems.length) {
        const packageItem = packageItems[0]!;
        throw new PackageError(
          409,
          `Remove package-covered service ${packageItem.serviceNameSnapshot} before creating this custom package`
        );
      }
    }
    if (input.soldByStaffId) {
      const staff = await tx.staff.findFirst({
        where: {
          id: input.soldByStaffId,
          salonId: cart.salonId,
          status: true,
          OR: [{ branchId: null }, { branchId: cart.branchId }],
        },
        select: { id: true },
      });
      if (!staff) throw new PackageError(400, "Invalid or unavailable staff");
    }
    const category = await ensureCustomPackageCategory(tx, cart.salonId);
    const resolved = await resolvePackageItems(
      tx,
      cart.salonId,
      cart.branchId,
      requestedItems
    );
    if (new Prisma.Decimal(input.specialPrice).gt(resolved.totalPrice)) {
      throw new PackageError(
        400,
        "Special price cannot exceed total price"
      );
    }
    const name = await uniquePackageName(tx, cart.salonId, input.name);
    const created = await tx.servicePackage.create({
      data: {
        salonId: cart.salonId,
        branchId: cart.branchId,
        categoryId: category.id,
        type: "CUSTOMER_CUSTOM",
        customerId: cart.customerId,
        sourceCustomerId: cart.customerId,
        name,
        description: input.description ?? null,
        totalPrice: resolved.totalPrice,
        specialPrice: input.specialPrice,
        validityDays: input.validityDays,
        status: "ACTIVE",
        createdById: actor.userId,
        items: {
          create: resolved.items.map(({ service, quantity }) => ({
            salonId: cart.salonId,
            serviceId: service.id,
            serviceNameSnapshot: service.name,
            quantity,
            priceSnapshot: service.price,
            durationMinutesSnapshot: serviceDurationMinutes(service),
          })),
        },
      },
      include: packageInclude,
    });
    await tx.appointmentService.deleteMany({
      where: {
        appointmentId: cart.id,
        customerPackageUsageItemId: null,
        serviceId: { in: requestedServiceIds },
      },
    });
    await tx.invoiceItem.create({
      data: {
        invoiceId: cart.invoice.id,
        itemType: "PACKAGE",
        packageId: created.id,
        soldByStaffId: input.soldByStaffId ?? null,
        itemCode: created.id.slice(0, 8),
        description: created.name,
        serviceName: created.name,
        quantity: 1,
        unitPrice: created.specialPrice,
        discountAmount: 0,
        taxPercent: 0,
        taxAmount: 0,
        lineTotal: created.specialPrice,
      },
    });
    await tx.invoiceItem.deleteMany({
      where: {
        invoiceId: cart.invoice.id,
        itemType: "SERVICE",
        serviceId: { in: requestedServiceIds },
      },
    });
    const freshCart = await tx.appointment.findUniqueOrThrow({
      where: { id: cart.id },
      include: {
        services: { orderBy: { createdAt: "asc" } },
        invoice: { include: { items: true } },
      },
    });
    const paidServices = freshCart.services.filter(
      (item) => !item.customerPackageUsageItemId
    );
    const serviceSubtotal = paidServices.reduce(
      (sum, item) => sum.add(item.price),
      new Prisma.Decimal(0)
    );
    const packageSubtotal = freshCart.invoice!.items
      .filter((item) => item.itemType === "PACKAGE")
      .reduce((sum, item) => sum.add(item.lineTotal), new Prisma.Decimal(0));
    const subtotal = serviceSubtotal.add(packageSubtotal).toDecimalPlaces(2);
    const membership = await resolveCurrentCustomerMembership(tx, {
      customerId: cart.customerId,
      actor,
      audit,
    });
    const discount = membership
      ? Prisma.Decimal.min(
          subtotal
            .mul(membership.discountPercentageSnapshot)
            .div(100)
            .toDecimalPlaces(2),
          subtotal
        )
      : new Prisma.Decimal(0);
    const total = subtotal.minus(discount).toDecimalPlaces(2);
    const totalDurationMinutes = paidServices.reduce(
      (sum, item) =>
        sum +
        (item.durationValue ?? 0) *
          (item.durationUnit === "HOURS" ? 60 : 1),
      0
    );
    const endTime = new Date(
      freshCart.startTime.getTime() +
        Math.max(totalDurationMinutes, 30) * 60_000
    );
    await tx.invoice.update({
      where: { id: cart.invoice.id },
      data: {
        subtotalAmount: subtotal,
        discountAmount: discount,
        couponDiscountAmount: 0,
        processingFeeAmount: 0,
        taxAmount: 0,
        totalAmount: total,
        balanceAmount: total,
      },
    });
    await tx.appointment.update({
      where: { id: cart.id },
      data: {
        totalDurationMinutes,
        estimatedAmount: subtotal,
        endTime,
      },
    });
    await createAuditLog({
      tx,
      salonId: cart.salonId,
      branchId: cart.branchId,
      userId: actor.userId,
      module: "PACKAGE",
      action: "CREATE",
      entityId: created.id,
      entityName: created.name,
      description: `Custom package ${created.name} created from job cart ${cart.appointmentCode}`,
      newData: {
        packageId: created.id,
        customerId: cart.customerId,
        jobCartId: cart.id,
        serviceIds: input.serviceIds,
      },
      ...audit,
    });
    return created;
  });

export const copyCustomerCustomPackage = async (
  actor: PackageActor,
  input: {
    sourcePackageId: string;
    targetCustomerId: string;
    branchId?: string | undefined;
    name?: string | undefined;
    description?: string | null | undefined;
    specialPrice?: number | undefined;
    validityDays?: number | undefined;
    status?: PackageStatus | undefined;
  },
  audit: AuditContext
) =>
  prisma.$transaction(async (tx) => {
    const source = await tx.servicePackage.findFirst({
      where: {
        id: input.sourcePackageId,
        type: "CUSTOMER_CUSTOM",
        ...scope(actor),
      },
      include: { ...packageInclude, items: { include: { service: true } } },
    });
    if (!source) throw new PackageError(404, "Custom package not found");
    const branchId =
      actor.role === "BRANCH_MANAGER"
        ? actor.branchId
        : input.branchId === undefined
          ? source.branchId
          : input.branchId;
    if (!branchId) throw new PackageError(400, "Branch is required");
    await assertBranch(tx, source.salonId, branchId);
    const customer = await assertCustomer(
      tx,
      actor,
      input.targetCustomerId,
      source.salonId,
      branchId
    );
    const category = await ensureCustomPackageCategory(tx, source.salonId);
    const specialPrice =
      input.specialPrice === undefined
        ? source.specialPrice
        : new Prisma.Decimal(input.specialPrice);
    if (specialPrice.gt(source.totalPrice)) {
      throw new PackageError(
        400,
        "Special price cannot exceed total price"
      );
    }
    const name = await uniquePackageName(
      tx,
      source.salonId,
      input.name ?? `${source.name} - ${customer.name}`
    );
    const copied = await tx.servicePackage.create({
      data: {
        salonId: source.salonId,
        branchId,
        categoryId: category.id,
        type: "CUSTOMER_CUSTOM",
        customerId: customer.id,
        sourceCustomerId: source.customerId ?? source.sourceCustomerId,
        sourcePackageId: source.id,
        name,
        description:
          input.description === undefined
            ? source.description
            : input.description,
        totalPrice: source.totalPrice,
        specialPrice,
        validityDays: input.validityDays ?? source.validityDays,
        status: input.status ?? "ACTIVE",
        createdById: actor.userId,
        items: {
          create: source.items.map((item) => ({
            salonId: source.salonId,
            serviceId: item.serviceId,
            serviceNameSnapshot: item.serviceNameSnapshot,
            quantity: item.quantity,
            priceSnapshot: item.priceSnapshot,
            durationMinutesSnapshot: item.durationMinutesSnapshot,
          })),
        },
      },
      include: packageInclude,
    });
    await createAuditLog({
      tx,
      salonId: copied.salonId,
      branchId: copied.branchId,
      userId: actor.userId,
      module: "PACKAGE",
      action: "CREATE",
      entityId: copied.id,
      entityName: copied.name,
      description: `Custom package ${source.name} copied for ${customer.name}`,
      newData: {
        sourcePackageId: source.id,
        sourceCustomerId: source.customerId,
        targetCustomerId: customer.id,
      },
      ...audit,
    });
    return copied;
  });

export const listCustomerCustomPackages = (
  actor: PackageActor,
  filters: {
    page: number;
    limit: number;
    search?: string | undefined;
    status?: PackageStatus | undefined;
    customerId?: string | undefined;
    salonId?: string | undefined;
    branchId?: string | undefined;
  }
) =>
  listServicePackages(actor, {
    ...filters,
    type: "CUSTOMER_CUSTOM",
  });

export const updateServicePackage = async (
  actor: PackageActor,
  id: string,
  input: {
    branchId?: string | null | undefined;
    categoryId: string;
    name: string;
    description?: string | null | undefined;
    specialPrice: number;
    validityDays: number;
    status?: PackageStatus | undefined;
    items?: Array<{ serviceId: string; quantity: number }> | undefined;
    serviceIds?: string[] | undefined;
  },
  audit: AuditContext
) =>
  prisma.$transaction(async (tx) => {
    const existing = await tx.servicePackage.findFirst({
      where: { id, ...managementScope(actor) },
      include: packageInclude,
    });
    if (!existing) throw new PackageError(404, "Package not found");
    const branchId =
      actor.role === "BRANCH_MANAGER"
        ? actor.branchId ?? null
        : input.branchId === undefined
          ? existing.branchId
          : input.branchId;
    await assertBranch(tx, existing.salonId, branchId);
    const category = await tx.packageCategory.findFirst({
      where: {
        id: input.categoryId,
        salonId: existing.salonId,
        status: "ACTIVE",
        ...(branchId
          ? { OR: [{ branchId: null }, { branchId }] }
          : {}),
      },
    });
    if (!category) throw new PackageError(400, "Invalid package category");
    const duplicate = await tx.servicePackage.findFirst({
      where: {
        salonId: existing.salonId,
        id: { not: id },
        name: { equals: input.name, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new PackageError(409, "Package name already exists in this salon");
    }
    const resolved = await resolvePackageItems(
      tx,
      existing.salonId,
      branchId,
      normalizeItems(input.items, input.serviceIds)
    );
    if (new Prisma.Decimal(input.specialPrice).gt(resolved.totalPrice)) {
      throw new PackageError(
        400,
        "Special price cannot exceed total price"
      );
    }
    await tx.servicePackageItem.deleteMany({ where: { packageId: id } });
    const updated = await tx.servicePackage.update({
      where: { id },
      data: {
        branchId,
        categoryId: category.id,
        name: input.name,
        description: input.description ?? null,
        totalPrice: resolved.totalPrice,
        specialPrice: input.specialPrice,
        validityDays: input.validityDays,
        ...(input.status ? { status: input.status } : {}),
        items: {
          create: resolved.items.map(({ service, quantity }) => ({
            salonId: existing.salonId,
            serviceId: service.id,
            serviceNameSnapshot: service.name,
            quantity,
            priceSnapshot: service.price,
            durationMinutesSnapshot: serviceDurationMinutes(service),
          })),
        },
      },
      include: packageInclude,
    });
    await createAuditLog({
      tx,
      salonId: existing.salonId,
      branchId: updated.branchId,
      userId: actor.userId,
      module: "PACKAGE",
      action: "UPDATE",
      entityId: id,
      entityName: updated.name,
      description: `Package ${updated.name} updated`,
      oldData: existing,
      newData: updated,
      ...audit,
    });
    return updated;
  });

export const setServicePackageStatus = async (
  actor: PackageActor,
  id: string,
  status: PackageStatus,
  audit: AuditContext
) =>
  prisma.$transaction(async (tx) => {
    const existing = await tx.servicePackage.findFirst({
      where: { id, ...managementScope(actor) },
    });
    if (!existing) throw new PackageError(404, "Package not found");
    const updated = await tx.servicePackage.update({
      where: { id },
      data: { status },
      include: packageInclude,
    });
    await createAuditLog({
      tx,
      salonId: existing.salonId,
      branchId: existing.branchId,
      userId: actor.userId,
      module: "PACKAGE",
      action: "STATUS_CHANGE",
      entityId: id,
      entityName: existing.name,
      description: `Package ${existing.name} ${status.toLowerCase()}`,
      oldData: { status: existing.status },
      newData: { status },
      ...audit,
    });
    return updated;
  });

export const deleteServicePackage = async (
  actor: PackageActor,
  id: string,
  audit: AuditContext
) =>
  prisma.$transaction(async (tx) => {
    const existing = await tx.servicePackage.findFirst({
      where: { id, ...managementScope(actor) },
      include: packageInclude,
    });
    if (!existing) throw new PackageError(404, "Package not found");
    const softDeleted =
      existing._count.customerPackages > 0 ||
      existing._count.invoiceItems > 0;
    if (softDeleted) {
      await tx.servicePackage.update({
        where: { id },
        data: { status: "INACTIVE" },
      });
    } else {
      await tx.servicePackage.delete({ where: { id } });
    }
    await createAuditLog({
      tx,
      salonId: existing.salonId,
      branchId: existing.branchId,
      userId: actor.userId,
      module: "PACKAGE",
      action: "DELETE",
      entityId: id,
      entityName: existing.name,
      description: `Package ${existing.name} ${softDeleted ? "deactivated" : "deleted"}`,
      oldData: existing,
      ...audit,
    });
    return { softDeleted };
  });

const customerPackageInclude = {
  package: {
    select: { id: true, name: true, categoryId: true },
  },
  customer: { select: { id: true, name: true, phone: true } },
  soldByStaff: { select: { id: true, name: true } },
  invoice: { select: { id: true, invoiceCode: true, status: true } },
  serviceBalances: {
    orderBy: { serviceNameSnapshot: "asc" as const },
  },
} as const;

const presentBalance = <
  T extends {
    includedQuantity: number;
    usedQuantity: number;
    reservedQuantity: number;
  },
>(
  balance: T
) => ({
  ...balance,
  remainingQuantity:
    balance.includedQuantity -
    balance.usedQuantity -
    balance.reservedQuantity,
});

const expireCustomerPackages = async (
  where: Prisma.CustomerPackageWhereInput
) =>
  prisma.customerPackage.updateMany({
    where: {
      ...where,
      status: "ACTIVE",
      validUntil: { lt: new Date() },
    },
    data: { status: "EXPIRED" },
  });

export const listCustomerPackages = async (
  actor: PackageActor,
  filters: {
    page: number;
    limit: number;
    salonId?: string | undefined;
    branchId?: string | undefined;
    status?: CustomerPackageStatus | undefined;
    customerId?: string | undefined;
    packageId?: string | undefined;
  }
) => {
  const where: Prisma.CustomerPackageWhereInput = {
    ...customerPackageScope(actor),
    ...(actor.role === "SUPER_ADMIN" && filters.salonId
      ? { salonId: filters.salonId }
      : {}),
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.packageId ? { packageId: filters.packageId } : {}),
  };
  await expireCustomerPackages(where);
  const [total, data] = await Promise.all([
    prisma.customerPackage.count({ where }),
    prisma.customerPackage.findMany({
      where,
      include: customerPackageInclude,
      orderBy: { purchasedAt: "desc" },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    }),
  ]);
  return {
    data,
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / filters.limit)),
    },
  };
};

export const getCustomerPackage = async (
  actor: PackageActor,
  id: string
) => {
  await expireCustomerPackages({ id, ...customerPackageScope(actor) });
  const data = await prisma.customerPackage.findFirst({
    where: { id, ...customerPackageScope(actor) },
    include: customerPackageInclude,
  });
  if (!data) throw new PackageError(404, "Customer package not found");
  return data;
};

export const setCustomerPackageStatus = async (
  actor: PackageActor,
  id: string,
  status: CustomerPackageStatus,
  audit: AuditContext
) =>
  prisma.$transaction(async (tx) => {
    const existing = await tx.customerPackage.findFirst({
      where: { id, ...customerPackageScope(actor) },
    });
    if (!existing) throw new PackageError(404, "Customer package not found");
    const updated = await tx.customerPackage.update({
      where: { id },
      data: { status },
      include: customerPackageInclude,
    });
    await createAuditLog({
      tx,
      salonId: existing.salonId,
      branchId: existing.branchId,
      userId: actor.userId,
      module: "PACKAGE",
      action: "STATUS_CHANGE",
      entityId: id,
      entityName: existing.packageNameSnapshot,
      description: `Customer package ${existing.packageNameSnapshot} marked ${status.toLowerCase()}`,
      oldData: { status: existing.status },
      newData: { status },
      ...audit,
    });
    return updated;
  });

export const getCustomerPackageBalances = async (
  actor: PackageActor,
  customerPackageId: string
) => {
  await expireCustomerPackages({
    id: customerPackageId,
    ...customerPackageScope(actor),
  });
  const customerPackage = await prisma.customerPackage.findFirst({
    where: { id: customerPackageId, ...customerPackageScope(actor) },
    include: {
      serviceBalances: {
        orderBy: { serviceNameSnapshot: "asc" },
      },
    },
  });
  if (!customerPackage) {
    throw new PackageError(404, "Customer package not found");
  }
  return {
    customerPackageId: customerPackage.id,
    packageName: customerPackage.packageNameSnapshot,
    status: customerPackage.status,
    validUntil: customerPackage.validUntil,
    balances: customerPackage.serviceBalances.map(presentBalance),
  };
};

export const getCustomerPackageUsages = async (
  actor: PackageActor,
  customerPackageId: string
) => {
  const customerPackage = await prisma.customerPackage.findFirst({
    where: { id: customerPackageId, ...customerPackageScope(actor) },
    select: { id: true },
  });
  if (!customerPackage) {
    throw new PackageError(404, "Customer package not found");
  }
  return prisma.customerPackageUsage.findMany({
    where: { customerPackageId },
    include: {
      items: {
        include: {
          staff: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });
};

export const getCustomerPackageBalancesForCustomer = async (
  actor: PackageActor,
  customerId: string
) => {
  const customer = await prisma.customer.findFirst({
    where: {
      id: customerId,
      ...(actor.role === "SUPER_ADMIN"
        ? {}
        : { salonId: actor.salonId ?? "__unauthorized__" }),
      ...(branchRoles.has(actor.role)
        ? { branchId: actor.branchId ?? "__unauthorized__" }
        : {}),
    },
    select: { id: true },
  });
  if (!customer) throw new PackageError(404, "Customer not found");
  await expireCustomerPackages({
    customerId,
    ...customerPackageScope(actor),
  });
  const packages = await prisma.customerPackage.findMany({
    where: { customerId, ...customerPackageScope(actor) },
    include: {
      soldByStaff: { select: { id: true, name: true } },
      serviceBalances: {
        orderBy: { serviceNameSnapshot: "asc" },
      },
    },
    orderBy: { purchasedAt: "desc" },
  });
  return packages.map((customerPackage) => ({
    customerPackageId: customerPackage.id,
    packageName: customerPackage.packageNameSnapshot,
    status: customerPackage.status,
    validUntil: customerPackage.validUntil,
    soldByStaff: customerPackage.soldByStaff,
    balances: customerPackage.serviceBalances.map(presentBalance),
  }));
};

const reverseUsedPackageUsages = async (
  tx: TransactionClient,
  input: {
    where: Prisma.CustomerPackageUsageWhereInput;
    referenceType: "invoice" | "appointment";
    referenceId: string;
    userId?: string | undefined;
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
  }
) => {
  const usages = await tx.customerPackageUsage.findMany({
    where: { ...input.where, status: "USED" },
    include: { items: true, customerPackage: true },
  });
  for (const usage of usages) {
    await tx.$queryRaw`SELECT "id" FROM "CustomerPackageUsage" WHERE "id" = ${usage.id} FOR UPDATE`;
    for (const item of usage.items) {
      await tx.$queryRaw`SELECT "id" FROM "CustomerPackageServiceBalance" WHERE "id" = ${item.customerPackageServiceBalanceId} FOR UPDATE`;
      const reversed = await tx.customerPackageServiceBalance.updateMany({
        where: {
          id: item.customerPackageServiceBalanceId,
          usedQuantity: { gte: item.quantity },
        },
        data: { usedQuantity: { decrement: item.quantity } },
      });
      if (reversed.count !== 1) {
        throw new PackageError(409, "Package usage balance changed");
      }
    }
    await tx.customerPackageUsage.update({
      where: { id: usage.id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    if (usage.customerPackage.status !== "CANCELLED") {
      await tx.customerPackage.update({
        where: { id: usage.customerPackageId },
        data: {
          status:
            usage.customerPackage.validUntil < new Date()
              ? "EXPIRED"
              : "ACTIVE",
        },
      });
    }
    await createAuditLog({
      tx,
      salonId: usage.salonId,
      branchId: usage.branchId,
      userId: input.userId,
      module: "PACKAGE",
      action: "CANCEL",
      entityId: usage.id,
      entityName: usage.customerPackage.packageNameSnapshot,
      description: `Package redemption reversed with ${input.referenceType} cancellation`,
      oldData: { status: "USED", items: usage.items },
      newData: {
        status: "CANCELLED",
        referenceType: input.referenceType,
        referenceId: input.referenceId,
      },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
  }
};

export const reverseUsedPackageUsagesForInvoice = async (
  tx: TransactionClient,
  input: {
    invoiceId: string;
    userId?: string | undefined;
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
  }
) =>
  reverseUsedPackageUsages(tx, {
    where: { invoiceId: input.invoiceId },
    referenceType: "invoice",
    referenceId: input.invoiceId,
    userId: input.userId,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

export const reverseUsedPackageUsagesForAppointment = async (
  tx: TransactionClient,
  input: {
    appointmentId: string;
    userId?: string | undefined;
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
  }
) =>
  reverseUsedPackageUsages(tx, {
    where: {
      OR: [
        { appointmentId: input.appointmentId },
        { jobCartAppointmentId: input.appointmentId },
      ],
    },
    referenceType: "appointment",
    referenceId: input.appointmentId,
    userId: input.userId,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });
