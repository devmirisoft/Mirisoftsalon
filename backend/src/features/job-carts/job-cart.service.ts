import { randomUUID } from "node:crypto";
import { prisma } from "../../config/prisma.js";
import { Prisma, type PaymentMethod } from "../../generated/prisma/client.js";
import {
  buildBusinessCode,
  businessCodeDayRange,
} from "../../utils/business-id.js";
import { AppointmentModel } from "../appointments/appointment.model.js";
import { createAuditLog } from "../audit-logs/audit-log.service.js";
import { issueInvoice } from "../coupons/coupon.service.js";
import { InvoiceModel } from "../Invoices/invoice.model.js";
import { reverseUsedPackageUsagesForInvoice } from "../packages/package.service.js";
import { normalizePhone } from "../public-booking/public-booking.service.js";
import { reverseAppointmentConsumables } from "../stock/appointmentConsumableReversal.service.js";
import { calculateInvoiceGst } from "../Invoices/invoice-gst.service.js";
import { createStockMovement } from "../stock/stockMovement.service.js";
import {
  getCurrentMembershipForCustomer,
  getCustomerMembershipHistory,
  resolveCurrentCustomerMembership,
} from "../customer-memberships/customer-membership.service.js";
import { checkStaffAvailabilityForSlot } from "../staff-availability/staffAvailability.service.js";
import {
  SettleInvoiceError,
  settleInvoiceInTransaction,
} from "../Payments/settle-invoice.service.js";
import { getSpendableWalletForCustomer } from "../membership-wallets/membership-wallet.service.js";

type TransactionClient = Prisma.TransactionClient;

export type JobCartActor = {
  userId: string;
  role: string;
  salonId?: string;
  branchId?: string;
};

type JobCartBillingInput = {
  invoiceType?: "GST_INVOICE" | "BILL_OF_SUPPLY" | undefined;
  status?: "DRAFT" | "ISSUED" | undefined;
  discountAmount?: number | undefined;
  processingFeeAmount?: number | undefined;
  taxPercent?: number | undefined;
  billingNote?: string | null | undefined;
  footerNote?: string | null | undefined;
  /**
   * Collected at the counter when the cart is confirmed. Omit `amount` to
   * settle the whole bill, which is the usual walk-in case.
   */
  payment?:
    | {
        method: PaymentMethod;
        amount?: number | undefined;
        referenceNo?: string | undefined;
        note?: string | undefined;
        customerMembershipId?: string | undefined;
      }
    | undefined;
  /** Split tender, e.g. 500 cash + 300 UPI. Settled in order. */
  payments?:
    | {
        method: PaymentMethod;
        amount: number;
        referenceNo?: string | undefined;
        note?: string | undefined;
        customerMembershipId?: string | undefined;
      }[]
    | undefined;
  idempotencyKey?: string | undefined;
  confirmedAt?: string | undefined;
};

type AuditContext = {
  ipAddress?: string;
  userAgent?: string;
};

export class JobCartError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "JobCartError";
  }
}

const branchScopedRoles = new Set(["BRANCH_MANAGER", "RECEPTIONIST"]);
const activeAppointmentStatuses = [
  "SCHEDULED",
  "CONFIRMED",
  "CHECKED_IN",
] as const;

const jobCartInclude = {
  salon: {
    select: {
      id: true,
      name: true,
      timezone: true,
      gstEnabled: true,
      gstNumber: true,
      gstLegalName: true,
      gstStateCode: true,
      serviceGstRate: true,
      productGstRate: true,
      membershipDiscountOnPackages: true,
    },
  },
  branch: { select: { id: true, name: true } },
  customer: {
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      customerCode: true,
      walletBalance: true,
      outstandingAmount: true,
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
  staff: { select: { id: true, name: true, jobRole: true } },
  createdBy: { select: { id: true, name: true, email: true, role: true } },
  services: {
    include: {
      service: {
        select: {
          id: true,
          name: true,
          status: true,
          durationValue: true,
          durationUnit: true,
        },
      },
      staff: { select: { id: true, name: true, jobRole: true } },
      customerPackageUsageItem: {
        select: { id: true, usageId: true },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
  invoice: {
    include: {
      items: {
        include: {
          package: {
            select: {
              id: true,
              name: true,
              totalPrice: true,
              specialPrice: true,
              validityDays: true,
            },
          },
          soldByStaff: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "asc" as const },
      },
      payments: { orderBy: { paidAt: "asc" as const } },
      coupon: true,
    },
  },
  packageUsageJobCarts: {
    include: {
      customerPackage: {
        select: {
          id: true,
          packageNameSnapshot: true,
          validUntil: true,
          status: true,
          maxRedemptionsSnapshot: true,
          usedRedemptions: true,
          reservedRedemptions: true,
        },
      },
      items: {
        include: {
          staff: { select: { id: true, name: true } },
          customerPackageServiceBalance: true,
        },
        orderBy: { createdAt: "asc" as const },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
} as const;

type JobCartRecord = Prisma.AppointmentGetPayload<{
  include: typeof jobCartInclude;
}>;

const mappedStatus = (cart: JobCartRecord) => {
  if (
    cart.status === "CANCELLED" ||
    cart.invoice?.status === "CANCELLED"
  ) {
    return "CANCELLED" as const;
  }
  if (
    cart.status === "COMPLETED" &&
    cart.invoice &&
    ["DRAFT", "ISSUED"].includes(cart.invoice.status)
  ) {
    return "COMPLETED" as const;
  }
  return "ACTIVE" as const;
};

const present = (cart: JobCartRecord) => ({
  id: cart.id,
  appointmentId: cart.id,
  jobCartId: cart.appointmentCode,
  appointmentCode: cart.appointmentCode,
  salonId: cart.salonId,
  branchId: cart.branchId,
  customerId: cart.customerId,
  staffId: cart.staffId,
  startTime: cart.startTime,
  endTime: cart.endTime,
  totalDurationMinutes: cart.totalDurationMinutes,
  estimatedAmount: cart.estimatedAmount,
  status: mappedStatus(cart),
  appointmentStatus: cart.status,
  source: cart.source,
  bookingNote: cart.bookingNote,
  internalNote: cart.internalNote,
  createdAt: cart.createdAt,
  updatedAt: cart.updatedAt,
  salon: cart.salon,
  branch: cart.branch,
  customer: cart.customer,
  staff: cart.staff,
  createdBy: cart.createdBy,
  editedBy: null,
  items: [
    ...cart.services
      .filter((item) => !item.customerPackageUsageItemId)
      .map((item) => ({ ...item, itemType: "SERVICE" as const })),
    ...(cart.invoice?.items ?? [])
      .filter((item) => item.itemType === "PRODUCT")
      .map((item) => ({
        id: item.id,
        itemType: "PRODUCT" as const,
        productId: item.productId,
        serviceName: item.description,
        price: item.unitPrice,
        quantity: item.quantity,
        lineTotal: item.lineTotal,
        soldByStaffId: item.soldByStaffId,
        soldByStaff: item.soldByStaff,
        createdAt: item.createdAt,
      })),
    ...(cart.invoice?.items ?? [])
      .filter((item) => item.itemType === "PACKAGE")
      .map((item) => ({
        id: item.id,
        itemType: "PACKAGE" as const,
        packageId: item.packageId,
        packageNameSnapshot: item.serviceName,
        serviceName: item.serviceName,
        price: item.unitPrice,
        quantity: item.quantity,
        soldByStaffId: item.soldByStaffId,
        soldByStaff: item.soldByStaff,
        package: item.package,
        createdAt: item.createdAt,
      })),
  ],
  packageRedemptions: cart.packageUsageJobCarts,
  invoice: cart.invoice,
});

const accessWhere = (actor: JobCartActor): Prisma.AppointmentWhereInput => {
  if (actor.role === "SUPER_ADMIN") return {};
  if (!actor.salonId) return { id: "__unauthorized__" };
  return {
    salonId: actor.salonId,
    ...(branchScopedRoles.has(actor.role)
      ? { branchId: actor.branchId ?? "__unauthorized__" }
      : {}),
  };
};

const requireCreateScope = (
  actor: JobCartActor,
  requestedSalonId: string | undefined,
  requestedBranchId: string
) => {
  const salonId =
    actor.role === "SUPER_ADMIN" ? requestedSalonId : actor.salonId;
  if (!salonId) {
    throw new JobCartError(400, "Salon is required");
  }
  const branchId = branchScopedRoles.has(actor.role)
    ? actor.branchId
    : requestedBranchId;
  if (!branchId) {
    throw new JobCartError(400, "Branch is required");
  }
  if (
    branchScopedRoles.has(actor.role) &&
    requestedBranchId !== actor.branchId
  ) {
    throw new JobCartError(404, "Branch not found");
  }
  return { salonId, branchId };
};

const durationMinutes = (service: {
  durationValue: number | null;
  durationUnit: "MINUTES" | "HOURS";
}) =>
  (service.durationValue ?? 0) *
  (service.durationUnit === "HOURS" ? 60 : 1);

const findCustomerByPhone = async (
  tx: typeof prisma | TransactionClient,
  salonId: string,
  normalizedPhone: string
) => {
  const digits = normalizedPhone.replace(/\D/g, "");
  const matches = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Customer"
    WHERE "salonId" = ${salonId}
      AND regexp_replace(COALESCE("phone", ''), '[^0-9]', '', 'g') = ${digits}
    LIMIT 1
  `;
  return matches[0]
    ? tx.customer.findUnique({ where: { id: matches[0].id } })
    : null;
};

const resolveCustomer = async (
  tx: TransactionClient,
  input: {
    salonId: string;
    branchId: string;
    customerName: string;
    phone: string;
  }
) => {
  const phone = normalizePhone(input.phone);
  let customer = await findCustomerByPhone(tx, input.salonId, phone);
  if (customer) {
    if (customer.name !== input.customerName || customer.phone !== phone) {
      customer = await tx.customer.update({
        where: { id: customer.id },
        data: { name: input.customerName, phone },
      });
    }
    return customer;
  }
  return tx.customer.create({
    data: {
      customerCode: `CUS-${Date.now()}-${randomUUID().slice(0, 8)}`,
      name: input.customerName,
      phone,
      salonId: input.salonId,
      branchId: input.branchId,
    },
  });
};

const validateBranch = async (
  tx: TransactionClient,
  salonId: string,
  branchId: string
) => {
  const branch = await tx.branch.findFirst({
    where: { id: branchId, salonId, status: true },
  });
  if (!branch) throw new JobCartError(400, "Invalid branch");
  return branch;
};

const validateStaff = async (
  tx: TransactionClient,
  salonId: string,
  branchId: string,
  staffId: string | null | undefined
) => {
  if (!staffId) return null;
  const staff = await tx.staff.findFirst({
    where: {
      id: staffId,
      salonId,
      status: true,
      OR: [{ branchId: null }, { branchId }],
    },
  });
  if (!staff) throw new JobCartError(400, "Invalid or unavailable staff");
  return staff;
};

const validateServices = async (
  tx: TransactionClient,
  salonId: string,
  branchId: string,
  serviceIds: string[]
) => {
  const uniqueIds = [...new Set(serviceIds)];
  if (uniqueIds.length !== serviceIds.length) {
    throw new JobCartError(400, "Duplicate services are not allowed");
  }
  if (!uniqueIds.length) return [];
  const services = await tx.service.findMany({
    where: {
      id: { in: uniqueIds },
      salonId,
      status: true,
      OR: [{ branchId: null }, { branchId }],
    },
  });
  if (services.length !== uniqueIds.length) {
    throw new JobCartError(400, "One or more services are unavailable");
  }
  const byId = new Map(services.map((service) => [service.id, service]));
  return uniqueIds.map((id) => byId.get(id)!);
};

const assertNoConflict = async (
  tx: TransactionClient,
  input: {
    salonId: string;
    branchId: string;
    staffId?: string | null;
    startTime: Date;
    endTime: Date;
    excludeAppointmentId?: string;
  }
) => {
  if (!input.staffId) return;
  await tx.$queryRaw`SELECT "id" FROM "Staff" WHERE "id" = ${input.staffId} FOR UPDATE`;
  const availability = await checkStaffAvailabilityForSlot({
    client: tx,
    salonId: input.salonId,
    branchId: input.branchId,
    staffId: input.staffId,
    startTime: input.startTime,
    endTime: input.endTime,
    ...(input.excludeAppointmentId
      ? { excludeAppointmentId: input.excludeAppointmentId }
      : {}),
  });
  if (!availability.available) {
    throw new JobCartError(
      availability.reason === "APPOINTMENT_CONFLICT" ? 409 : 400,
      availability.message
    );
  }
};

const assertNoStaffConflicts = async (
  tx: TransactionClient,
  input: {
    salonId: string;
    branchId: string;
    staffIds: Array<string | null | undefined>;
    startTime: Date;
    endTime: Date;
    excludeAppointmentId?: string;
  }
) => {
  const staffIds = [...new Set(input.staffIds.filter(Boolean))] as string[];
  for (const staffId of staffIds) {
    await assertNoConflict(tx, {
      salonId: input.salonId,
      branchId: input.branchId,
      staffId,
      startTime: input.startTime,
      endTime: input.endTime,
      ...(input.excludeAppointmentId
        ? { excludeAppointmentId: input.excludeAppointmentId }
        : {}),
    });
  }
};

const loadCart = async (
  client: typeof prisma | TransactionClient,
  id: string,
  actor: JobCartActor
) =>
  client.appointment.findFirst({
    where: {
      id,
      walkInJobCart: true,
      source: "WALK_IN",
      ...accessWhere(actor),
    },
    include: jobCartInclude,
  });

const requireCart = async (
  client: typeof prisma | TransactionClient,
  id: string,
  actor: JobCartActor
) => {
  const cart = await loadCart(client, id, actor);
  if (!cart) throw new JobCartError(404, "Job cart not found");
  return cart;
};

const requireMutable = (cart: JobCartRecord) => {
  if (mappedStatus(cart) !== "ACTIVE" || cart.invoice?.status !== "DRAFT") {
    throw new JobCartError(
      409,
      "Completed or cancelled job carts cannot be edited"
    );
  }
  if (
    !cart.invoice ||
    cart.invoice.paymentStatus !== "UNPAID" ||
    cart.invoice.paidAmount.gt(0)
  ) {
    throw new JobCartError(409, "Paid job carts cannot be edited");
  }
};

const decimalOrZero = (value: unknown) => {
  try {
    return new Prisma.Decimal(
      (value ?? 0) as string | number | Prisma.Decimal
    ).toDecimalPlaces(2);
  } catch {
    return new Prisma.Decimal(0);
  }
};

/**
 * Which invoice lines a membership percentage is allowed to reduce.
 *
 * Services: always. Products: never - a product is sold at its own price even
 * to a member. Packages: only when the salon opts in, because a package is
 * already sold at a discounted price and stacking is usually double-dipping.
 */
const isMembershipDiscountable = (
  itemType: string,
  salon: { membershipDiscountOnPackages: boolean }
) => {
  if (itemType === "PRODUCT") return false;
  if (itemType === "PACKAGE") return salon.membershipDiscountOnPackages;
  return true;
};

const recalculateCart = async (
  tx: TransactionClient,
  appointmentId: string,
  actor: JobCartActor,
  audit: AuditContext
) => {
  const cart = await tx.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      salon: {
        select: {
          gstEnabled: true,
          gstNumber: true,
          gstLegalName: true,
          gstStateCode: true,
          serviceGstRate: true,
          productGstRate: true,
          membershipDiscountOnPackages: true,
        },
      },
      services: { orderBy: { createdAt: "asc" } },
      customer: {
        include: {
          membership: true,
        },
      },
      invoice: {
        include: { items: true, payments: true },
      },
    },
  });
  if (!cart?.invoice) throw new JobCartError(409, "Draft invoice is missing");
  if (
    cart.invoice.status !== "DRAFT" ||
    cart.invoice.paymentStatus !== "UNPAID" ||
    cart.invoice.paidAmount.gt(0)
  ) {
    throw new JobCartError(409, "Job cart invoice can no longer be changed");
  }
  if (cart.invoice.couponId) {
    throw new JobCartError(409, "Remove the coupon before changing job items");
  }
  const loyaltyAdjustment = await tx.customerTransaction.findFirst({
    where: {
      invoiceId: cart.invoice.id,
      type: "ADJUSTMENT",
    },
    select: { id: true },
  });
  if (loyaltyAdjustment) {
    throw new JobCartError(
      409,
      "Job items cannot change after loyalty redemption"
    );
  }

  // Lines that survive a recalculation: packages and products already sit on
  // the invoice, services are rebuilt below from the cart. Services covered by
  // a package redemption are excluded - the customer already paid for those.
  const keptItems = cart.invoice.items.filter(
    (item) => item.itemType === "PACKAGE" || item.itemType === "PRODUCT"
  );
  const paidServices = cart.services.filter(
    (item) => !item.customerPackageUsageItemId
  );
  const gstLines = [
    ...paidServices.map((item) => ({
      itemType: "SERVICE",
      quantity: 1,
      unitPrice: item.price,
      discountable: isMembershipDiscountable("SERVICE", cart.salon),
    })),
    ...keptItems.map((item) => ({
      itemType: item.itemType,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discountable: isMembershipDiscountable(item.itemType, cart.salon),
    })),
  ];
  const subtotal = gstLines.reduce(
    (sum, line) =>
      sum.add(new Prisma.Decimal(line.quantity).mul(line.unitPrice)),
    new Prisma.Decimal(0)
  );
  const currentMembership = await resolveCurrentCustomerMembership(tx, {
    customerId: cart.customerId,
    actor,
    audit,
  });
  const membershipPercentage =
    currentMembership?.discountPercentageSnapshot ?? new Prisma.Decimal(0);
  // The percentage applies only to the lines it is allowed to touch, so a
  // member never gets money off a product.
  const discountableSubtotal = gstLines.reduce(
    (sum, line) =>
      line.discountable
        ? sum.add(new Prisma.Decimal(line.quantity).mul(line.unitPrice))
        : sum,
    new Prisma.Decimal(0)
  );
  const membershipDiscount = Prisma.Decimal.min(
    discountableSubtotal.mul(membershipPercentage).div(100).toDecimalPlaces(2),
    discountableSubtotal
  );
  // Tax is computed live so the running total on the job card matches the bill
  // the customer will actually be asked to pay.
  const draftCalculation = calculateInvoiceGst(
    {
      invoiceType: cart.invoice.invoiceType,
      discountAmount: membershipDiscount,
      couponDiscountAmount: new Prisma.Decimal(0),
      processingFeeAmount: new Prisma.Decimal(0),
      items: gstLines,
    },
    cart.salon
  );
  const total = draftCalculation.totalAmount;
  const totalDurationMinutes = cart.services.reduce(
    (sum, item) =>
      sum +
      durationMinutes({
        durationValue: item.durationValue,
        durationUnit: item.durationUnit ?? "MINUTES",
      }),
    0
  );
  const endTime = new Date(
    cart.startTime.getTime() +
      Math.max(totalDurationMinutes, 30) * 60_000
  );
  await assertNoStaffConflicts(tx, {
    salonId: cart.salonId,
    branchId: cart.branchId!,
    staffIds: [
      cart.staffId,
      ...cart.services.map((item) => item.staffId),
    ],
    startTime: cart.startTime,
    endTime,
    excludeAppointmentId: cart.id,
  });

  await tx.invoiceItem.deleteMany({
    where: { invoiceId: cart.invoice.id, itemType: "SERVICE" },
  });
  await tx.invoice.update({
    where: { id: cart.invoice.id },
    data: {
      subtotalAmount: subtotal,
      discountAmount: membershipDiscount,
      membershipDiscountAmount: membershipDiscount,
      couponDiscountAmount: 0,
      processingFeeAmount: 0,
      serviceTaxableAmount: draftCalculation.serviceTaxableAmount,
      productTaxableAmount: draftCalculation.productTaxableAmount,
      serviceGstAmount: draftCalculation.serviceGstAmount,
      productGstAmount: draftCalculation.productGstAmount,
      totalGstAmount: draftCalculation.totalGstAmount,
      taxAmount: draftCalculation.totalGstAmount,
      roundOffAmount: draftCalculation.roundOffAmount,
      totalAmount: total,
      balanceAmount: total,
      items: {
        create: paidServices.map((item) => ({
          itemType: "SERVICE",
          serviceId: item.serviceId,
          soldByStaffId: item.staffId,
          itemCode: item.serviceId.slice(0, 8),
          description: item.serviceName,
          serviceName: item.serviceName,
          quantity: 1,
          unitPrice: item.price,
          discountAmount: 0,
          taxPercent: 0,
          taxAmount: 0,
          lineTotal: item.price,
        })),
      },
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
};

export const listJobCarts = async (
  actor: JobCartActor,
  filters: {
    page: number;
    limit: number;
    salonId?: string;
    branchId?: string;
    customerId?: string;
    search?: string;
    customerName?: string;
    phone?: string;
    status?: "ACTIVE" | "COMPLETED" | "CANCELLED";
    startDate?: Date;
    endDate?: Date;
    createdById?: string;
  }
) => {
  const scope = accessWhere(actor);
  const branchId = branchScopedRoles.has(actor.role)
    ? actor.branchId
    : filters.branchId;
  const statusWhere: Prisma.AppointmentWhereInput =
    filters.status === "ACTIVE"
      ? {
          status: { in: [...activeAppointmentStatuses] },
          invoice: { is: { status: "DRAFT" } },
        }
      : filters.status === "COMPLETED"
        ? {
            status: "COMPLETED",
            invoice: { is: { status: { in: ["DRAFT", "ISSUED"] } } },
          }
        : filters.status === "CANCELLED"
          ? {
              OR: [
                { status: "CANCELLED" },
                { invoice: { is: { status: "CANCELLED" } } },
              ],
            }
          : {};
  const search = filters.search?.trim();
  const where: Prisma.AppointmentWhereInput = {
    walkInJobCart: true,
    source: "WALK_IN",
    ...scope,
    ...(actor.role === "SUPER_ADMIN" && filters.salonId
      ? { salonId: filters.salonId }
      : {}),
    ...(branchId ? { branchId } : {}),
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.createdById ? { createdById: filters.createdById } : {}),
    ...(filters.startDate || filters.endDate
      ? {
          startTime: {
            ...(filters.startDate ? { gte: filters.startDate } : {}),
            ...(filters.endDate ? { lte: filters.endDate } : {}),
          },
        }
      : {}),
    ...((filters.customerName || filters.phone || search)
      ? {
          AND: [
            ...(filters.customerName
              ? [
                  {
                    customer: {
                      name: {
                        contains: filters.customerName,
                        mode: "insensitive" as const,
                      },
                    },
                  },
                ]
              : []),
            ...(filters.phone
              ? [
                  {
                    customer: {
                      phone: {
                        contains: filters.phone,
                        mode: "insensitive" as const,
                      },
                    },
                  },
                ]
              : []),
            ...(search
              ? [
            {
              OR: [
                {
                  id: { contains: search, mode: "insensitive" as const },
                },
                {
                  appointmentCode: {
                    contains: search,
                    mode: "insensitive" as const,
                  },
                },
                {
                  customer: {
                    name: {
                      contains: search,
                      mode: "insensitive" as const,
                    },
                  },
                },
                {
                  customer: {
                    phone: {
                      contains: search,
                      mode: "insensitive" as const,
                    },
                  },
                },
                {
                  services: {
                    some: {
                      serviceName: {
                        contains: search,
                        mode: "insensitive" as const,
                      },
                    },
                  },
                },
              ],
            },
                ]
              : []),
          ],
        }
      : {}),
    ...statusWhere,
  };
  const [total, rows] = await Promise.all([
    prisma.appointment.count({ where }),
    prisma.appointment.findMany({
      where,
      include: jobCartInclude,
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    }),
  ]);
  return {
    data: rows.map(present),
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      totalPages: Math.max(Math.ceil(total / filters.limit), 1),
    },
  };
};

export const getJobCart = async (actor: JobCartActor, id: string) =>
  present(await requireCart(prisma, id, actor));

export const getJobCartReferences = async (
  actor: JobCartActor,
  requestedSalonId?: string,
  requestedBranchId?: string
) => {
  const salonId =
    actor.role === "SUPER_ADMIN" ? requestedSalonId : actor.salonId;
  const salons =
    actor.role === "SUPER_ADMIN"
      ? await prisma.salon.findMany({
          where: { status: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [];
  if (!salonId) {
    return { salons, branches: [], staff: [], services: [] };
  }
  const salon = await prisma.salon.findFirst({
    where: { id: salonId, status: true },
    select: {
      id: true,
      name: true,
      gstEnabled: true,
      serviceGstRate: true,
    },
  });
  const branchId = branchScopedRoles.has(actor.role)
    ? actor.branchId
    : requestedBranchId;
  const branchWhere: Prisma.BranchWhereInput = {
    salonId,
    status: true,
    ...(branchScopedRoles.has(actor.role)
      ? { id: actor.branchId ?? "__unauthorized__" }
      : {}),
  };
  const resourceBranchWhere = branchId
    ? { OR: [{ branchId: null }, { branchId }] }
    : {};
  const [branches, staff, services] = await Promise.all([
    prisma.branch.findMany({
      where: branchWhere,
      select: { id: true, name: true, salonId: true },
      orderBy: { name: "asc" },
    }),
    prisma.staff.findMany({
      where: { salonId, status: true, ...resourceBranchWhere },
      select: { id: true, name: true, jobRole: true, branchId: true },
      orderBy: { name: "asc" },
    }),
    prisma.service.findMany({
      where: { salonId, status: true, ...resourceBranchWhere },
      select: {
        id: true,
        name: true,
        price: true,
        durationValue: true,
        durationUnit: true,
        branchId: true,
        mainServiceId: true,
        mainService: { select: { id: true, name: true } },
      },
      orderBy: { name: "asc" },
    }),
  ]);
  const packages = await prisma.servicePackage.findMany({
    where: {
      salonId,
      status: "ACTIVE",
      type: "STANDARD",
      ...(branchId ? { OR: [{ branchId: null }, { branchId }] } : {}),
    },
    include: {
      category: { select: { id: true, name: true } },
      items: {
        select: {
          id: true,
          serviceId: true,
          serviceNameSnapshot: true,
          quantity: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });
  const products = await prisma.product.findMany({
    where: {
      salonId,
      status: true,
      ...(branchId ? { OR: [{ branchId: null }, { branchId }] } : {}),
    },
    select: {
      id: true,
      name: true,
      sku: true,
      sellingPrice: true,
      currentStock: true,
      unit: true,
    },
    orderBy: { name: "asc" },
  });
  return { salons, salon, branches, staff, services, packages, products };
};

export const getJobCartCustomerSummary = async (
  actor: JobCartActor,
  query: { customerId?: string | undefined; phone?: string | undefined }
) => {
  const branchWhere = branchScopedRoles.has(actor.role)
    ? { branchId: actor.branchId ?? "__unauthorized__" }
    : {};
  let customerId = query.customerId;
  if (!customerId && query.phone) {
    if (actor.role !== "SUPER_ADMIN" && !actor.salonId) {
      throw new JobCartError(400, "Salon is required");
    }
    if (actor.salonId) {
      const customer = await findCustomerByPhone(
        prisma,
        actor.salonId,
        normalizePhone(query.phone)
      );
      customerId = customer?.id;
    } else {
      const digits = normalizePhone(query.phone).replace(/\D/g, "");
      const matches = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Customer"
        WHERE regexp_replace(COALESCE("phone", ''), '[^0-9]', '', 'g') = ${digits}
        ORDER BY "createdAt" DESC
        LIMIT 1
      `;
      customerId = matches[0]?.id;
    }
  }
  if (!customerId) throw new JobCartError(404, "Customer not found");

  const customer = await prisma.customer.findFirst({
    where: {
      id: customerId,
      ...(actor.role === "SUPER_ADMIN"
        ? {}
        : { salonId: actor.salonId ?? "__unauthorized__" }),
      ...branchWhere,
    },
    include: {
      membership: {
        select: { id: true, name: true, status: true },
      },
    },
  });
  if (!customer) throw new JobCartError(404, "Customer not found");
  const currentMembership = await getCurrentMembershipForCustomer(
    actor,
    customer.id,
    {}
  );
  const membershipHistory = currentMembership
    ? []
    : await getCustomerMembershipHistory(actor, customer.id, {});
  const latestMembership = membershipHistory[0];
  const spendableWallet = await getSpendableWalletForCustomer(
    prisma,
    actor,
    customer.id
  );

  await prisma.customerPackage.updateMany({
    where: {
      customerId: customer.id,
      status: "ACTIVE",
      validUntil: { lt: new Date() },
    },
    data: { status: "EXPIRED" },
  });

  const appointmentWhere: Prisma.AppointmentWhereInput = {
    customerId: customer.id,
    status: "COMPLETED",
    ...(branchScopedRoles.has(actor.role) ? branchWhere : {}),
  };
  const [visits, activePackages, recentInvoices, spend, productPurchases, retailPurchases] = await Promise.all([
    prisma.appointment.findMany({
      where: appointmentWhere,
      select: {
        startTime: true,
        staffId: true,
        staff: { select: { id: true, name: true } },
        _count: { select: { services: true } },
      },
      orderBy: { startTime: "desc" },
    }),
    prisma.customerPackage.findMany({
      where: {
        customerId: customer.id,
        status: "ACTIVE",
        validUntil: { gte: new Date() },
        ...(branchScopedRoles.has(actor.role) ? branchWhere : {}),
      },
      select: {
        id: true,
        packageNameSnapshot: true,
        validUntil: true,
        status: true,
        soldByStaff: { select: { name: true } },
        serviceBalances: {
          orderBy: { serviceNameSnapshot: "asc" },
        },
      },
      orderBy: { validUntil: "asc" },
    }),
    prisma.invoice.findMany({
      where: {
        customerId: customer.id,
        ...(branchScopedRoles.has(actor.role) ? branchWhere : {}),
      },
      select: {
        id: true,
        invoiceCode: true,
        invoiceDate: true,
        totalAmount: true,
        paidAmount: true,
        balanceAmount: true,
        status: true,
        paymentStatus: true,
      },
      orderBy: { invoiceDate: "desc" },
      take: 10,
    }),
    prisma.invoice.aggregate({
      where: {
        customerId: customer.id,
        status: { not: "CANCELLED" },
        ...(branchScopedRoles.has(actor.role) ? branchWhere : {}),
      },
      _sum: { totalAmount: true, paidAmount: true },
      _count: { _all: true },
    }),
    prisma.invoiceItem.findMany({
      where: {
        itemType: "PRODUCT",
        invoice: {
          customerId: customer.id,
          status: { not: "CANCELLED" },
          ...(branchScopedRoles.has(actor.role) ? branchWhere : {}),
        },
      },
      select: {
        id: true,
        description: true,
        serviceName: true,
        quantity: true,
        unitPrice: true,
        totalWithTax: true,
        lineTotal: true,
        soldByStaff: { select: { name: true } },
        invoice: { select: { invoiceCode: true, invoiceDate: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.retailSaleItem.findMany({
      where: {
        sale: {
          customerId: customer.id,
          ...(branchScopedRoles.has(actor.role) ? branchWhere : {}),
        },
      },
      select: {
        id: true,
        quantity: true,
        unitPrice: true,
        totalPrice: true,
        product: { select: { name: true } },
        sale: {
          select: {
            saleCode: true,
            saleDate: true,
            staff: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const staffStats = new Map<
    string,
    { staffId: string; staffName: string; serviceCount: number; recent: Date }
  >();
  for (const visit of visits) {
    if (!visit.staffId || !visit.staff) continue;
    const current = staffStats.get(visit.staffId);
    const serviceCount = Math.max(visit._count.services, 1);
    if (current) {
      current.serviceCount += serviceCount;
    } else {
      staffStats.set(visit.staffId, {
        staffId: visit.staffId,
        staffName: visit.staff.name,
        serviceCount,
        recent: visit.startTime,
      });
    }
  }
  const preferred = [...staffStats.values()].sort(
    (left, right) =>
      right.serviceCount - left.serviceCount ||
      right.recent.getTime() - left.recent.getTime()
  )[0];

  return {
    customerId: customer.id,
    customerName: customer.name,
    phone: customer.phone,
    membershipName:
      currentMembership?.membershipNameSnapshot ??
      latestMembership?.membershipNameSnapshot ??
      null,
    membershipStartsAt:
      currentMembership?.startsAt ?? latestMembership?.startsAt ?? null,
    membershipExpiresAt:
      currentMembership?.expiresAt ?? latestMembership?.expiresAt ?? null,
    membershipStatus:
      currentMembership?.status ?? latestMembership?.status ?? null,
    currentCustomerMembershipId: currentMembership?.id ?? null,
    // What the counter may put on the bill from membership wallets right now,
    // summed across every spendable membership the customer holds.
    membershipWalletBalance: spendableWallet.total,
    loyaltyPoints: customer.loyaltyPoints,
    walletBalance: customer.walletBalance,
    outstandingBalance: customer.outstandingAmount,
    totalVisits: visits.length,
    lastVisitDate: visits[0]?.startTime ?? null,
    firstVisitDate: visits[visits.length - 1]?.startTime ?? null,
    visitDates: visits.map((visit) => visit.startTime),
    invoiceCount: spend._count._all,
    totalSpend: spend._sum.totalAmount ?? 0,
    totalPaid: spend._sum.paidAmount ?? 0,
    averageSpend:
      spend._count._all > 0
        ? Number(spend._sum.totalAmount ?? 0) / spend._count._all
        : 0,
    preferredStaff: preferred
      ? {
          staffId: preferred.staffId,
          staffName: preferred.staffName,
          serviceCount: preferred.serviceCount,
        }
      : null,
    activePackages: activePackages.map((item) => ({
      customerPackageId: item.id,
      packageName: item.packageNameSnapshot,
      validUntil: item.validUntil,
      status: item.status,
      soldByStaffName: item.soldByStaff?.name ?? null,
      serviceBalances: item.serviceBalances.map((balance) => ({
        balanceId: balance.id,
        serviceId: balance.serviceId,
        serviceName: balance.serviceNameSnapshot,
        includedQuantity: balance.includedQuantity,
        usedQuantity: balance.usedQuantity,
        reservedQuantity: balance.reservedQuantity,
        remainingQuantity:
          balance.includedQuantity -
          balance.usedQuantity -
          balance.reservedQuantity,
      })),
    })),
    productPurchases: [
      ...productPurchases.map((item) => ({
        id: item.id,
        source: "INVOICE" as const,
        reference: item.invoice.invoiceCode,
        date: item.invoice.invoiceDate,
        productName: item.description || item.serviceName,
        quantity: Number(item.quantity),
        unitPrice: item.unitPrice,
        totalAmount: Number(item.totalWithTax) || Number(item.lineTotal),
        soldByStaffName: item.soldByStaff?.name ?? null,
      })),
      ...retailPurchases.map((item) => ({
        id: item.id,
        source: "RETAIL" as const,
        reference: item.sale.saleCode,
        date: item.sale.saleDate,
        productName: item.product.name,
        quantity: Number(item.quantity),
        unitPrice: item.unitPrice,
        totalAmount: Number(item.totalPrice),
        soldByStaffName: item.sale.staff?.name ?? null,
      })),
    ].sort((left, right) => right.date.getTime() - left.date.getTime()),
    recentInvoices: recentInvoices.map((invoice) => ({
      id: invoice.id,
      invoiceId: invoice.id,
      invoiceCode: invoice.invoiceCode,
      date: invoice.invoiceDate,
      totalAmount: invoice.totalAmount,
      paidAmount: invoice.paidAmount,
      balanceDue: invoice.balanceAmount,
      status:
        invoice.status === "CANCELLED"
          ? invoice.status
          : invoice.paymentStatus,
    })),
  };
};

export const createJobCart = async (
  actor: JobCartActor,
  input: {
    salonId?: string;
    branchId: string;
    customerName: string;
    phone: string;
    startTime: Date;
    staffId?: string;
    serviceIds: string[];
    serviceItems?: Array<{ serviceId: string; staffId?: string | undefined }>;
    bookingNote?: string;
    internalNote?: string;
  },
  audit: AuditContext
) =>
  prisma.$transaction(async (tx) => {
    const { salonId, branchId } = requireCreateScope(
      actor,
      input.salonId,
      input.branchId
    );
    const [branch, salon] = await Promise.all([
      validateBranch(tx, salonId, branchId),
      tx.salon.findFirst({
        where: { id: salonId, status: true },
      }),
    ]);
    if (!salon) throw new JobCartError(400, "Invalid salon");
    await validateStaff(tx, salonId, branchId, input.staffId);
    for (const serviceItem of input.serviceItems ?? []) {
      await validateStaff(tx, salonId, branchId, serviceItem.staffId);
    }
    const services = await validateServices(
      tx,
      salonId,
      branchId,
      input.serviceIds
    );
    const staffByServiceId = new Map(
      (input.serviceItems ?? []).map((item) => [
        item.serviceId,
        item.staffId,
      ])
    );
    const appointmentStaffId =
      input.staffId ??
      services
        .map((service) => staffByServiceId.get(service.id))
        .find(Boolean);
    const duration = services.reduce(
      (sum, service) => sum + durationMinutes(service),
      0
    );
    if (input.startTime < new Date()) {
      throw new JobCartError(400, "Job cart start time cannot be in the past");
    }
    const endTime = new Date(
      input.startTime.getTime() + Math.max(duration, 30) * 60_000
    );
    await assertNoStaffConflicts(tx, {
      salonId,
      branchId,
      staffIds: [
        appointmentStaffId,
        ...services.map((service) => staffByServiceId.get(service.id)),
      ],
      startTime: input.startTime,
      endTime,
    });
    const customer = await resolveCustomer(tx, {
      salonId,
      branchId,
      customerName: input.customerName,
      phone: input.phone,
    });
    const codeDate = new Date();
    const invoiceDayRange = businessCodeDayRange(codeDate, salon.timezone);
    const invoiceSerial =
      (await tx.invoice.count({
        where: {
          salonId,
          invoiceDate: {
            gte: invoiceDayRange.start,
            lt: invoiceDayRange.end,
          },
        },
      })) + 1;
    const appointment = await AppointmentModel.create(
      {
        appointmentCode: buildBusinessCode({
          salonName: salon.name,
          type: "JC",
          date: codeDate,
          timezone: salon.timezone,
        }),
        salonId,
        branchId,
        customerId: customer.id,
        ...(appointmentStaffId ? { staffId: appointmentStaffId } : {}),
        createdById: actor.userId,
        startTime: input.startTime,
        endTime,
        totalDurationMinutes: duration,
        estimatedAmount: services.reduce(
          (sum, service) => sum + Number(service.price),
          0
        ),
        status: "SCHEDULED",
        source: "WALK_IN",
        walkInJobCart: true,
        ...(input.bookingNote ? { bookingNote: input.bookingNote } : {}),
        ...(input.internalNote ? { internalNote: input.internalNote } : {}),
        services: services.map((service) => {
          const serviceStaffId = staffByServiceId.get(service.id);
          return {
            serviceId: service.id,
            serviceName: service.name,
            price: Number(service.price),
            ...(serviceStaffId ? { staffId: serviceStaffId } : {}),
            ...(service.durationValue !== null
              ? { durationValue: service.durationValue }
              : {}),
            durationUnit: service.durationUnit,
          };
        }),
      },
      tx
    );
    const membership = await resolveCurrentCustomerMembership(tx, {
      customerId: customer.id,
      actor,
      audit,
    });
    const subtotal = services.reduce(
      (sum, service) => sum.add(service.price),
      new Prisma.Decimal(0)
    );
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
    const invoice = await InvoiceModel.create(
      {
        invoiceCode: buildBusinessCode({
          salonName: salon.name,
          type: "INV",
          date: codeDate,
          timezone: salon.timezone,
          serial: invoiceSerial,
        }),
        salonId,
        branchId,
        customerId: customer.id,
        appointmentId: appointment.id,
        invoiceType: "BILL_OF_SUPPLY",
        salonName: salon.name,
        ...(salon.phone ? { salonPhone: salon.phone } : {}),
        ...(salon.email ? { salonEmail: salon.email } : {}),
        salonAddress: [
          salon.addressLine1,
          salon.addressLine2,
          salon.city,
          salon.state,
          salon.country,
          salon.postalCode,
          branch.name,
        ]
          .filter(Boolean)
          .join(", "),
        customerName: customer.name,
        ...(customer.phone ? { customerPhone: customer.phone } : {}),
        ...(customer.email ? { customerEmail: customer.email } : {}),
        ...(customer.gst ? { customerGst: customer.gst } : {}),
        subtotalAmount: Number(subtotal),
        discountAmount: Number(discount),
        processingFeeAmount: 0,
        taxAmount: 0,
        totalAmount: Number(total),
        paidAmount: 0,
        balanceAmount: Number(total),
        status: "DRAFT",
        paymentStatus: "UNPAID",
        billingNote: `Walk-in job cart ${appointment.appointmentCode}`,
        items: services.map((service) => {
          const serviceStaffId = staffByServiceId.get(service.id);
          return {
            itemType: "SERVICE",
            serviceId: service.id,
            ...(serviceStaffId ? { soldByStaffId: serviceStaffId } : {}),
            itemCode: service.id.slice(0, 8),
            description: service.name,
            serviceName: service.name,
            quantity: 1,
            unitPrice: Number(service.price),
            discountAmount: 0,
            taxPercent: 0,
            taxAmount: 0,
            lineTotal: Number(service.price),
          };
        }),
      },
      tx
    );
    await createAuditLog({
      tx,
      salonId,
      branchId,
      userId: actor.userId,
      module: "JOB_CART",
      action: "CREATE",
      entityId: appointment.id,
      entityCode: appointment.appointmentCode,
      entityName: customer.name,
      description: `Job cart ${appointment.appointmentCode} created`,
      newData: {
        customerId: customer.id,
        staffId: appointment.staffId,
        startTime: appointment.startTime,
        serviceIds: services.map((service) => service.id),
        serviceItems: services.map((service) => ({
          serviceId: service.id,
          staffId: staffByServiceId.get(service.id) ?? null,
        })),
        invoiceId: invoice.id,
      },
      ...audit,
    });
    return present(await requireCart(tx, appointment.id, actor));
  });

export const updateJobCart = async (
  actor: JobCartActor,
  id: string,
  input: {
    customerName?: string;
    phone?: string;
    startTime?: Date;
    staffId?: string | null;
    bookingNote?: string | null;
    internalNote?: string | null;
  },
  audit: AuditContext
) =>
  prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Appointment" WHERE "id" = ${id} FOR UPDATE`;
    const existing = await requireCart(tx, id, actor);
    requireMutable(existing);
    const customer =
      input.customerName || input.phone
        ? await resolveCustomer(tx, {
            salonId: existing.salonId,
            branchId: existing.branchId!,
            customerName: input.customerName ?? existing.customer.name,
            phone: input.phone ?? existing.customer.phone ?? "",
          })
        : await tx.customer.findUniqueOrThrow({
            where: { id: existing.customer.id },
          });
    const staffId =
      input.staffId === undefined ? existing.staffId : input.staffId;
    await validateStaff(
      tx,
      existing.salonId,
      existing.branchId!,
      staffId
    );
    const startTime = input.startTime ?? existing.startTime;
    if (input.startTime !== undefined && startTime < new Date()) {
      throw new JobCartError(400, "Job cart start time cannot be in the past");
    }
    const endTime = new Date(
      startTime.getTime() +
        Math.max(existing.totalDurationMinutes, 30) * 60_000
    );
    await assertNoStaffConflicts(tx, {
      salonId: existing.salonId,
      branchId: existing.branchId!,
      staffIds: [
        staffId,
        ...existing.services.map((item) => item.staffId),
      ],
      startTime,
      endTime,
      excludeAppointmentId: existing.id,
    });
    await tx.appointment.update({
      where: { id },
      data: {
        customerId: customer.id,
        staffId,
        startTime,
        endTime,
        ...(input.bookingNote !== undefined
          ? { bookingNote: input.bookingNote }
          : {}),
        ...(input.internalNote !== undefined
          ? { internalNote: input.internalNote }
          : {}),
      },
    });
    await tx.invoice.update({
      where: { id: existing.invoice!.id },
      data: {
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerEmail: customer.email,
        customerGst: customer.gst,
      },
    });
    if (customer.id !== existing.customer.id) {
      await recalculateCart(tx, id, actor, audit);
    }
    await createAuditLog({
      tx,
      salonId: existing.salonId,
      branchId: existing.branchId,
      userId: actor.userId,
      module: "JOB_CART",
      action: "UPDATE",
      entityId: id,
      entityCode: existing.appointmentCode,
      entityName: customer.name,
      description: `Job cart ${existing.appointmentCode} updated`,
      oldData: {
        customerId: existing.customerId,
        staffId: existing.staffId,
        startTime: existing.startTime,
      },
      newData: { customerId: customer.id, staffId, startTime },
      ...audit,
    });
    return present(await requireCart(tx, id, actor));
  });

export const addJobCartItem = async (
  actor: JobCartActor,
  id: string,
  input: {
    itemType: "SERVICE" | "PACKAGE" | "PRODUCT";
    serviceId?: string;
    packageId?: string;
    productId?: string;
    quantity?: number;
    staffId?: string;
  },
  audit: AuditContext
) =>
  prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Appointment" WHERE "id" = ${id} FOR UPDATE`;
    const existing = await requireCart(tx, id, actor);
    requireMutable(existing);
    if (input.itemType === "PRODUCT") {
      const product = await tx.product.findFirst({
        where: {
          id: input.productId ?? "__missing__",
          salonId: existing.salonId,
          status: true,
          OR: [{ branchId: null }, { branchId: existing.branchId }],
        },
        select: {
          id: true,
          name: true,
          sku: true,
          sellingPrice: true,
          currentStock: true,
        },
      });
      if (!product) {
        throw new JobCartError(400, "Product is unavailable");
      }
      const quantity = input.quantity ?? 1;
      // Stock leaves the shelf at confirm, not here, so the cart can still be
      // edited. The check is repeated there under a row lock, which is what
      // actually prevents overselling.
      if (product.currentStock.lt(quantity)) {
        throw new JobCartError(
          409,
          `Only ${product.currentStock} of ${product.name} in stock`
        );
      }
      if (input.staffId) {
        await validateStaff(
          tx,
          existing.salonId,
          existing.branchId!,
          input.staffId
        );
      }
      const existingLine = existing.invoice!.items.find(
        (item) => item.itemType === "PRODUCT" && item.productId === product.id
      );
      if (existingLine) {
        // Same product twice is a quantity change, not a second line.
        const newQuantity = existingLine.quantity + quantity;
        if (product.currentStock.lt(newQuantity)) {
          throw new JobCartError(
            409,
            `Only ${product.currentStock} of ${product.name} in stock`
          );
        }
        await tx.invoiceItem.update({
          where: { id: existingLine.id },
          data: {
            quantity: newQuantity,
            lineTotal: product.sellingPrice.mul(newQuantity),
          },
        });
      } else {
        await tx.invoiceItem.create({
          data: {
            invoiceId: existing.invoice!.id,
            itemType: "PRODUCT",
            productId: product.id,
            soldByStaffId: input.staffId ?? null,
            itemCode: product.sku ?? product.id.slice(0, 8),
            description: product.name,
            serviceName: product.name,
            quantity,
            unitPrice: product.sellingPrice,
            discountAmount: 0,
            taxPercent: 0,
            taxAmount: 0,
            lineTotal: product.sellingPrice.mul(quantity),
          },
        });
      }
      await recalculateCart(tx, id, actor, audit);
      await createAuditLog({
        tx,
        salonId: existing.salonId,
        branchId: existing.branchId,
        userId: actor.userId,
        module: "JOB_CART",
        action: "UPDATE",
        entityId: id,
        entityCode: existing.appointmentCode,
        entityName: existing.customer.name,
        description: `Product ${product.name} x${quantity} added to job cart ${existing.appointmentCode}`,
        newData: {
          itemType: "PRODUCT",
          productId: product.id,
          productName: product.name,
          quantity,
          unitPrice: product.sellingPrice,
          soldByStaffId: input.staffId,
        },
        ...audit,
      });
    } else if (input.itemType === "PACKAGE") {
      const servicePackage = await tx.servicePackage.findFirst({
        where: {
          id: input.packageId ?? "__missing__",
          salonId: existing.salonId,
          status: "ACTIVE",
          AND: [
            { OR: [{ branchId: null }, { branchId: existing.branchId }] },
            {
              OR: [
                { type: "STANDARD" },
                {
                  type: "CUSTOMER_CUSTOM",
                  customerId: existing.customerId,
                },
              ],
            },
          ],
        },
        include: {
          items: { select: { serviceId: true, serviceNameSnapshot: true } },
        },
      });
      if (!servicePackage) {
        throw new JobCartError(400, "Package is unavailable");
      }
      if (
        existing.invoice!.items.some(
          (item) =>
            item.itemType === "PACKAGE" &&
            item.packageId === servicePackage.id
        )
      ) {
        throw new JobCartError(409, "Package is already in the job cart");
      }
      const existingServiceIds = new Set(
        existing.services
          .filter((item) => !item.customerPackageUsageItemId)
          .map((item) => item.serviceId)
      );
      const overlapping = servicePackage.items.find((item) =>
        existingServiceIds.has(item.serviceId)
      );
      if (overlapping) {
        throw new JobCartError(
          409,
          `${overlapping.serviceNameSnapshot} is already selected as a standalone service`
        );
      }
      if (input.staffId) {
        await validateStaff(
          tx,
          existing.salonId,
          existing.branchId!,
          input.staffId
        );
      }
      const item = await tx.invoiceItem.create({
        data: {
          invoiceId: existing.invoice!.id,
          itemType: "PACKAGE",
          packageId: servicePackage.id,
          soldByStaffId: input.staffId ?? null,
          itemCode: servicePackage.id.slice(0, 8),
          description: servicePackage.name,
          serviceName: servicePackage.name,
          quantity: 1,
          unitPrice: servicePackage.specialPrice,
          discountAmount: 0,
          taxPercent: 0,
          taxAmount: 0,
          lineTotal: servicePackage.specialPrice,
        },
      });
      await recalculateCart(tx, id, actor, audit);
      await createAuditLog({
        tx,
        salonId: existing.salonId,
        branchId: existing.branchId,
        userId: actor.userId,
        module: "JOB_CART",
        action: "UPDATE",
        entityId: id,
        entityCode: existing.appointmentCode,
        entityName: existing.customer.name,
        description: `Package ${servicePackage.name} added to job cart ${existing.appointmentCode}`,
        newData: {
          itemId: item.id,
          itemType: "PACKAGE",
          packageId: servicePackage.id,
          packageName: servicePackage.name,
          price: servicePackage.specialPrice,
          soldByStaffId: input.staffId,
        },
        ...audit,
      });
    } else {
      const [service] = await validateServices(
        tx,
        existing.salonId,
        existing.branchId!,
        [input.serviceId ?? ""]
      );
      if (!service) throw new JobCartError(400, "Service is unavailable");
      if (existing.services.some((item) => item.serviceId === service.id)) {
        throw new JobCartError(409, "Service is already in the job cart");
      }
      const packageIds = existing.invoice!.items
        .filter((item) => item.itemType === "PACKAGE" && item.packageId)
        .map((item) => item.packageId!);
      if (packageIds.length) {
        const packageService = await tx.servicePackageItem.findFirst({
          where: { packageId: { in: packageIds }, serviceId: service.id },
          select: { serviceNameSnapshot: true },
        });
        if (packageService) {
          throw new JobCartError(
            409,
            `${packageService.serviceNameSnapshot} is already covered by a selected package`
          );
        }
      }
      if (input.staffId) {
        await validateStaff(
          tx,
          existing.salonId,
          existing.branchId!,
          input.staffId
        );
      }
      const item = await tx.appointmentService.create({
        data: {
          appointmentId: existing.id,
          serviceId: service.id,
          serviceName: service.name,
          price: service.price,
          staffId: input.staffId ?? null,
          durationValue: service.durationValue,
          durationUnit: service.durationUnit,
        },
      });
      await recalculateCart(tx, id, actor, audit);
      await createAuditLog({
        tx,
        salonId: existing.salonId,
        branchId: existing.branchId,
        userId: actor.userId,
        module: "JOB_CART",
        action: "UPDATE",
        entityId: id,
        entityCode: existing.appointmentCode,
        entityName: existing.customer.name,
        description: `Service ${service.name} added to job cart ${existing.appointmentCode}`,
        newData: {
          itemId: item.id,
          itemType: "SERVICE",
          serviceId: service.id,
          serviceName: service.name,
          price: service.price,
          staffId: input.staffId,
        },
        ...audit,
      });
    }
    return present(await requireCart(tx, id, actor));
  });

export const removeJobCartItem = async (
  actor: JobCartActor,
  id: string,
  itemId: string,
  audit: AuditContext
) =>
  prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Appointment" WHERE "id" = ${id} FOR UPDATE`;
    const existing = await requireCart(tx, id, actor);
    requireMutable(existing);
    const serviceItem = existing.services.find(
      (service) => service.id === itemId
    );
    const packageItem = existing.invoice!.items.find(
      (item) =>
        item.id === itemId &&
        (item.itemType === "PACKAGE" || item.itemType === "PRODUCT")
    );
    if (!serviceItem && !packageItem) {
      throw new JobCartError(404, "Job cart item not found");
    }
    if (serviceItem) {
      await tx.appointmentService.delete({ where: { id: serviceItem.id } });
    } else {
      await tx.invoiceItem.delete({ where: { id: packageItem!.id } });
    }
    await recalculateCart(tx, id, actor, audit);
    await createAuditLog({
      tx,
      salonId: existing.salonId,
      branchId: existing.branchId,
      userId: actor.userId,
      module: "JOB_CART",
      action: "DELETE",
      entityId: id,
      entityCode: existing.appointmentCode,
      entityName: existing.customer.name,
      description: `${serviceItem ? "Service" : "Package"} ${
        serviceItem?.serviceName ?? packageItem!.serviceName
      } removed from job cart ${existing.appointmentCode}`,
      oldData: {
        itemId,
        itemType: serviceItem ? "SERVICE" : "PACKAGE",
        serviceId: serviceItem?.serviceId,
        packageId: packageItem?.packageId,
        itemName: serviceItem?.serviceName ?? packageItem?.serviceName,
        price: serviceItem?.price ?? packageItem?.unitPrice,
      },
      ...audit,
    });
    return present(await requireCart(tx, id, actor));
  });

const cancelReservedUsage = async (
  tx: TransactionClient,
  usage: {
    id: string;
    salonId: string;
    branchId: string;
    customerPackageId: string;
    items: Array<{
      id: string;
      quantity: number;
      customerPackageServiceBalanceId: string;
      serviceNameSnapshot: string;
      appointmentServices: Array<{ id: string }>;
      invoiceItem: { id: string } | null;
    }>;
  },
  actor: JobCartActor,
  audit: AuditContext,
  description: string
) => {
  for (const item of usage.items) {
    await tx.$queryRaw`SELECT "id" FROM "CustomerPackageServiceBalance" WHERE "id" = ${item.customerPackageServiceBalanceId} FOR UPDATE`;
    const released = await tx.customerPackageServiceBalance.updateMany({
      where: {
        id: item.customerPackageServiceBalanceId,
        reservedQuantity: { gte: item.quantity },
      },
      data: { reservedQuantity: { decrement: item.quantity } },
    });
    if (released.count !== 1) {
      throw new JobCartError(409, "Package reservation balance changed");
    }
    if (item.appointmentServices.length) {
      await tx.appointmentService.deleteMany({
        where: { id: { in: item.appointmentServices.map((row) => row.id) } },
      });
    }
    if (item.invoiceItem) {
      await tx.invoiceItem.delete({ where: { id: item.invoiceItem.id } });
    }
  }
  const cancelled = await tx.customerPackageUsage.update({
    where: { id: usage.id },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  await createAuditLog({
    tx,
    salonId: usage.salonId,
    branchId: usage.branchId,
    userId: actor.userId,
    module: "PACKAGE",
    action: "CANCEL",
    entityId: usage.id,
    description,
    oldData: {
      status: "RESERVED",
      customerPackageId: usage.customerPackageId,
    },
    newData: { status: cancelled.status },
    ...audit,
  });
};

export const addJobCartPackageRedemption = async (
  actor: JobCartActor,
  id: string,
  input: {
    customerPackageId: string;
    items: Array<{
      serviceId: string;
      quantity: number;
      staffId?: string | undefined;
    }>;
  },
  audit: AuditContext
) =>
  prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Appointment" WHERE "id" = ${id} FOR UPDATE`;
    const existing = await requireCart(tx, id, actor);
    requireMutable(existing);
    await tx.$queryRaw`SELECT "id" FROM "CustomerPackage" WHERE "id" = ${input.customerPackageId} FOR UPDATE`;
    const customerPackage = await tx.customerPackage.findFirst({
      where: {
        id: input.customerPackageId,
        salonId: existing.salonId,
        customerId: existing.customerId,
      },
      include: {
        package: { select: { branchId: true } },
        serviceBalances: true,
      },
    });
    if (!customerPackage) {
      throw new JobCartError(404, "Customer package not found");
    }
    if (
      customerPackage.status !== "ACTIVE" ||
      customerPackage.validUntil < new Date()
    ) {
      throw new JobCartError(409, "Customer package is not active");
    }
    if (
      customerPackage.package.branchId &&
      customerPackage.package.branchId !== existing.branchId
    ) {
      throw new JobCartError(400, "Package is not valid for this branch");
    }

    const balances = new Map(
      customerPackage.serviceBalances.map((balance) => [
        balance.serviceId,
        balance,
      ])
    );
    for (const requested of input.items) {
      const balance = balances.get(requested.serviceId);
      if (!balance) {
        throw new JobCartError(400, "Service is not included in this package");
      }
      await tx.$queryRaw`SELECT "id" FROM "CustomerPackageServiceBalance" WHERE "id" = ${balance.id} FOR UPDATE`;
      const current = await tx.customerPackageServiceBalance.findUniqueOrThrow({
        where: { id: balance.id },
      });
      const remaining =
        current.includedQuantity -
        current.usedQuantity -
        current.reservedQuantity;
      if (remaining < requested.quantity) {
        throw new JobCartError(
          409,
          `Only ${remaining} ${current.serviceNameSnapshot} redemption(s) remain`
        );
      }
      if (requested.staffId) {
        await validateStaff(
          tx,
          existing.salonId,
          existing.branchId!,
          requested.staffId
        );
      }
    }

    const usage = await tx.customerPackageUsage.create({
      data: {
        salonId: existing.salonId,
        branchId: existing.branchId!,
        customerId: existing.customerId,
        customerPackageId: customerPackage.id,
        appointmentId: existing.id,
        invoiceId: existing.invoice!.id,
        jobCartAppointmentId: existing.id,
        status: "RESERVED",
        createdById: actor.userId,
      },
    });

    for (const requested of input.items) {
      const balance = balances.get(requested.serviceId)!;
      const usageItem = await tx.customerPackageUsageItem.create({
        data: {
          salonId: existing.salonId,
          usageId: usage.id,
          customerPackageServiceBalanceId: balance.id,
          serviceId: balance.serviceId,
          serviceNameSnapshot: balance.serviceNameSnapshot,
          quantity: requested.quantity,
          priceSnapshot: balance.priceSnapshot,
          durationMinutesSnapshot: balance.durationMinutesSnapshot,
          staffId: requested.staffId ?? null,
        },
      });
      const reserved = await tx.customerPackageServiceBalance.updateMany({
        where: {
          id: balance.id,
          includedQuantity: {
            gte:
              balance.usedQuantity +
              balance.reservedQuantity +
              requested.quantity,
          },
        },
        data: { reservedQuantity: { increment: requested.quantity } },
      });
      if (reserved.count !== 1) {
        throw new JobCartError(409, "Package service balance changed");
      }
      await tx.appointmentService.createMany({
        data: Array.from({ length: requested.quantity }, () => ({
          appointmentId: existing.id,
          serviceId: balance.serviceId,
          serviceName: balance.serviceNameSnapshot,
          price: new Prisma.Decimal(0),
          durationValue: balance.durationMinutesSnapshot,
          durationUnit: "MINUTES" as const,
          customerPackageUsageItemId: usageItem.id,
        })),
      });
      await tx.invoiceItem.create({
        data: {
          invoiceId: existing.invoice!.id,
          serviceId: balance.serviceId,
          itemType: "PACKAGE_REDEMPTION",
          customerPackageUsageItemId: usageItem.id,
          itemCode: `RED-${balance.serviceId.slice(0, 8)}`,
          description: `${balance.serviceNameSnapshot} — package covered`,
          serviceName: balance.serviceNameSnapshot,
          quantity: requested.quantity,
          unitPrice: 0,
          discountAmount: 0,
          taxPercent: 0,
          taxAmount: 0,
          lineTotal: 0,
        },
      });
    }
    await recalculateCart(tx, id, actor, audit);
    await createAuditLog({
      tx,
      salonId: existing.salonId,
      branchId: existing.branchId,
      userId: actor.userId,
      module: "PACKAGE",
      action: "CREATE",
      entityId: usage.id,
      entityName: customerPackage.packageNameSnapshot,
      description: `Package redemption reserved in job cart ${existing.appointmentCode}`,
      newData: {
        customerPackageId: customerPackage.id,
        items: input.items,
        status: "RESERVED",
      },
      ...audit,
    });
    return present(await requireCart(tx, id, actor));
  });

export const removeJobCartPackageRedemption = async (
  actor: JobCartActor,
  id: string,
  usageId: string,
  audit: AuditContext
) =>
  prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Appointment" WHERE "id" = ${id} FOR UPDATE`;
    const existing = await requireCart(tx, id, actor);
    requireMutable(existing);
    await tx.$queryRaw`SELECT "id" FROM "CustomerPackageUsage" WHERE "id" = ${usageId} FOR UPDATE`;
    const usage = await tx.customerPackageUsage.findFirst({
      where: {
        id: usageId,
        jobCartAppointmentId: id,
        status: "RESERVED",
        salonId: existing.salonId,
      },
      include: {
        items: {
          include: {
            appointmentServices: { select: { id: true } },
            invoiceItem: { select: { id: true } },
          },
        },
      },
    });
    if (!usage) {
      throw new JobCartError(404, "Reserved package redemption not found");
    }
    await cancelReservedUsage(
      tx,
      usage,
      actor,
      audit,
      `Package redemption removed from job cart ${existing.appointmentCode}`
    );
    await recalculateCart(tx, id, actor, audit);
    return present(await requireCart(tx, id, actor));
  });

export const getJobCartPackageRedemptions = async (
  actor: JobCartActor,
  id: string
) => {
  const cart = await requireCart(prisma, id, actor);
  return cart.packageUsageJobCarts;
};

const useReservedPackageRedemptions = async (
  tx: TransactionClient,
  cart: JobCartRecord,
  actor: JobCartActor,
  audit: AuditContext
) => {
  const reservedUsages = cart.packageUsageJobCarts.filter(
    (usage) => usage.status === "RESERVED"
  );
  const affectedPackages = new Set<string>();
  for (const usage of reservedUsages) {
    await tx.$queryRaw`SELECT "id" FROM "CustomerPackageUsage" WHERE "id" = ${usage.id} FOR UPDATE`;
    for (const item of usage.items) {
      await tx.$queryRaw`SELECT "id" FROM "CustomerPackageServiceBalance" WHERE "id" = ${item.customerPackageServiceBalanceId} FOR UPDATE`;
      const moved = await tx.customerPackageServiceBalance.updateMany({
        where: {
          id: item.customerPackageServiceBalanceId,
          reservedQuantity: { gte: item.quantity },
        },
        data: {
          reservedQuantity: { decrement: item.quantity },
          usedQuantity: { increment: item.quantity },
        },
      });
      if (moved.count !== 1) {
        throw new JobCartError(409, "Package reservation balance changed");
      }
    }
    await tx.customerPackageUsage.update({
      where: { id: usage.id },
      data: { status: "USED", usedAt: new Date() },
    });
    affectedPackages.add(usage.customerPackageId);
    await createAuditLog({
      tx,
      salonId: usage.salonId,
      branchId: usage.branchId,
      userId: actor.userId,
      module: "PACKAGE",
      action: "COMPLETE",
      entityId: usage.id,
      entityName: usage.customerPackage.packageNameSnapshot,
      description: `Package redemption used in job cart ${cart.appointmentCode}`,
      oldData: { status: "RESERVED" },
      newData: { status: "USED", items: usage.items },
      ...audit,
    });
  }
  for (const customerPackageId of affectedPackages) {
    const balances = await tx.customerPackageServiceBalance.findMany({
      where: { customerPackageId },
    });
    if (
      balances.length > 0 &&
      balances.every(
        (balance) => balance.usedQuantity >= balance.includedQuantity
      )
    ) {
      await tx.customerPackage.update({
        where: { id: customerPackageId },
        data: { status: "USED" },
      });
    }
  }
};

export const confirmJobCart = async (
  actor: JobCartActor,
  id: string,
  audit: AuditContext,
  billing: JobCartBillingInput = {}
) =>
  prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Appointment" WHERE "id" = ${id} FOR UPDATE`;
    const existing = await requireCart(tx, id, actor);
    requireMutable(existing);
    if (!existing.invoice?.items.length) {
      throw new JobCartError(
        400,
        "Add at least one service or package before confirming"
      );
    }
    await assertNoStaffConflicts(tx, {
      salonId: existing.salonId,
      branchId: existing.branchId!,
      staffIds: [
        existing.staffId,
        ...existing.services.map((item) => item.staffId),
      ],
      startTime: existing.startTime,
      endTime: existing.endTime,
      excludeAppointmentId: existing.id,
    });
    await useReservedPackageRedemptions(tx, existing, actor, audit);
    const invoiceType = billing.invoiceType ?? existing.invoice.invoiceType;
    const manualDiscount = Prisma.Decimal.min(
      decimalOrZero(billing.discountAmount),
      existing.invoice.subtotalAmount
    ).toDecimalPlaces(2);
    const processingFee = decimalOrZero(billing.processingFeeAmount);
    const currentMembership = await resolveCurrentCustomerMembership(tx, {
      customerId: existing.customerId,
      actor,
      audit,
    });
    // Only the lines a membership may touch form the base, so products (and
    // packages, unless the salon opted in) are billed at full price.
    const membershipDiscountableSubtotal = existing.invoice.items.reduce(
      (sum, item) =>
        isMembershipDiscountable(item.itemType, existing.salon)
          ? sum.plus(new Prisma.Decimal(item.quantity).mul(item.unitPrice))
          : sum,
      new Prisma.Decimal(0)
    ).toDecimalPlaces(2);
    const membershipDiscount = currentMembership
      ? Prisma.Decimal.min(
          membershipDiscountableSubtotal
            .mul(currentMembership.discountPercentageSnapshot)
            .div(100),
          Prisma.Decimal.max(
            membershipDiscountableSubtotal.minus(manualDiscount),
            new Prisma.Decimal(0)
          )
        ).toDecimalPlaces(2)
      : new Prisma.Decimal(0);
    const discountAmount = Prisma.Decimal.min(
      manualDiscount.plus(membershipDiscount),
      existing.invoice.subtotalAmount
    ).toDecimalPlaces(2);
    const taxPercent =
      billing.taxPercent === undefined ? null : decimalOrZero(billing.taxPercent);
    const gstSettings =
      taxPercent && invoiceType === "GST_INVOICE"
        ? {
            ...existing.salon,
            gstEnabled: true,
            serviceGstRate: taxPercent,
            productGstRate: taxPercent,
          }
        : existing.salon;
    const calculation = calculateInvoiceGst(
      {
        invoiceType,
        discountAmount,
        couponDiscountAmount: existing.invoice.couponDiscountAmount,
        processingFeeAmount: processingFee,
        items: existing.invoice.items.map((item) => ({
          ...item,
          discountable: isMembershipDiscountable(item.itemType, existing.salon),
        })),
      },
      gstSettings
    );
    for (const [index, item] of existing.invoice.items.entries()) {
      const line = calculation.lines[index];
      if (!line) continue;
      await tx.invoiceItem.update({
        where: { id: item.id },
        data: {
          taxableAmount: line.taxableAmount,
          gstRateSnapshot: line.gstRateSnapshot,
          gstAmount: line.gstAmount,
          totalWithTax: line.totalWithTax,
          taxPercent: line.taxPercent,
          taxAmount: line.taxAmount,
          lineTotal: line.lineTotal,
        },
      });
    }
    await tx.invoice.update({
      where: { id: existing.invoice.id },
      data: {
        invoiceType,
        discountAmount,
        membershipDiscountAmount: membershipDiscount,
        processingFeeAmount: processingFee,
        serviceTaxableAmount: calculation.serviceTaxableAmount,
        productTaxableAmount: calculation.productTaxableAmount,
        serviceGstAmount: calculation.serviceGstAmount,
        productGstAmount: calculation.productGstAmount,
        totalGstAmount: calculation.totalGstAmount,
        gstNumberSnapshot: calculation.gstNumberSnapshot,
        gstLegalNameSnapshot: calculation.gstLegalNameSnapshot,
        gstStateCodeSnapshot: calculation.gstStateCodeSnapshot,
        gstEnabledSnapshot: calculation.gstEnabledSnapshot,
        taxAmount: calculation.totalGstAmount,
        roundOffAmount: calculation.roundOffAmount,
        totalAmount: calculation.totalAmount,
        balanceAmount: calculation.totalAmount,
        ...(billing.idempotencyKey
          ? { idempotencyKey: billing.idempotencyKey }
          : {}),
        ...(billing.billingNote !== undefined
          ? { billingNote: billing.billingNote }
          : {}),
        ...(billing.footerNote !== undefined
          ? { footerNote: billing.footerNote }
          : {}),
      },
    });
    await AppointmentModel.updateStatusWithHistory(
      id,
      {
        oldStatus: existing.status,
        newStatus: "COMPLETED",
        note: "Walk-in job cart confirmed",
        changedById: actor.userId,
      },
      tx
    );
    if (billing.status !== "DRAFT") {
      const issued = await issueInvoice({
        invoiceId: existing.invoice.id,
        salonId: existing.salonId,
        userId: actor.userId,
        tx,
        allowWalkInJobCart: true,
        ...audit,
      });
      // Payment is taken against the issued totals, so rounding and GST
      // applied above are already reflected in what the counter collects.
      // One entry for a single tender, several for a split. Each is settled
      // against the balance left by the previous one; the whole confirm rolls
      // back if any of them fails.
      const tenders = billing.payments?.length
        ? billing.payments
        : billing.payment
          ? [billing.payment]
          : [];
      if (tenders.length && issued.totalAmount.gt(0)) {
        for (const tender of tenders) {
          try {
            await settleInvoiceInTransaction(
              tx,
              actor,
              existing.invoice.id,
              {
                method: tender.method,
                amount: tender.amount,
                referenceNo: tender.referenceNo,
                note: tender.note,
                customerMembershipId: tender.customerMembershipId,
                jobCartAppointmentId: existing.id,
              },
              audit
            );
          } catch (error) {
            if (error instanceof SettleInvoiceError) {
              throw new JobCartError(error.status, error.message);
            }
            throw error;
          }
        }
      }
    } else if (billing.payment || billing.payments?.length) {
      throw new JobCartError(
        400,
        "Issue the invoice to record a payment; a draft cannot be paid"
      );
    }
    // Stock leaves the shelf here, inside the confirm transaction, so a
    // shortfall or any later failure rolls the whole bill back. Ordered by id
    // to keep the row-lock order stable between concurrent confirms.
    const productItems = existing.invoice.items
      .filter((item) => item.itemType === "PRODUCT" && item.productId)
      .sort((left, right) => left.productId!.localeCompare(right.productId!));
    for (const item of productItems) {
      try {
        await createStockMovement({
          tx,
          salonId: existing.salonId,
          ...(existing.branchId ? { branchId: existing.branchId } : {}),
          productId: item.productId!,
          type: "RETAIL_SALE",
          quantity: item.quantity,
          referenceType: "JOB_CART",
          referenceId: existing.id,
          ...(actor.userId ? { createdById: actor.userId } : {}),
        });
      } catch (error) {
        throw new JobCartError(
          409,
          error instanceof Error
            ? error.message
            : "Product stock could not be updated"
        );
      }
    }
    const packageItems = existing.invoice.items.filter(
      (item) => item.itemType === "PACKAGE" && item.packageId
    );
    for (const item of packageItems) {
      const servicePackage = await tx.servicePackage.findUnique({
        where: { id: item.packageId! },
        include: { items: true },
      });
      if (!servicePackage) {
        throw new JobCartError(409, "A sold package no longer exists");
      }
      const purchasedAt = new Date();
      const validUntil = new Date(purchasedAt);
      validUntil.setUTCDate(
        validUntil.getUTCDate() + servicePackage.validityDays
      );
      const customerPackage = await tx.customerPackage.create({
        data: {
          salonId: existing.salonId,
          branchId: existing.branchId!,
          customerId: existing.customerId,
          packageId: servicePackage.id,
          packageNameSnapshot: item.serviceName,
          totalPriceSnapshot: servicePackage.totalPrice,
          specialPriceSnapshot: item.unitPrice,
          validityDaysSnapshot: servicePackage.validityDays,
          purchasedAt,
          validUntil,
          status: "ACTIVE",
          soldByStaffId: item.soldByStaffId,
          invoiceId: existing.invoice.id,
          jobCartAppointmentId: existing.id,
          createdById: actor.userId,
          serviceBalances: {
            create: servicePackage.items.map((packageItem) => ({
              salonId: existing.salonId,
              branchId: existing.branchId!,
              customerId: existing.customerId,
              packageId: servicePackage.id,
              serviceId: packageItem.serviceId,
              serviceNameSnapshot: packageItem.serviceNameSnapshot,
              includedQuantity: packageItem.quantity,
              usedQuantity: 0,
              reservedQuantity: 0,
              priceSnapshot: packageItem.priceSnapshot,
              durationMinutesSnapshot:
                packageItem.durationMinutesSnapshot,
            })),
          },
        },
      });
      await createAuditLog({
        tx,
        salonId: existing.salonId,
        branchId: existing.branchId,
        userId: actor.userId,
        module: "PACKAGE",
        action: "CREATE",
        entityId: customerPackage.id,
        entityName: customerPackage.packageNameSnapshot,
        description: `Customer package ${customerPackage.packageNameSnapshot} created from job cart ${existing.appointmentCode}`,
        newData: customerPackage,
        ...audit,
      });
    }
    await createAuditLog({
      tx,
      salonId: existing.salonId,
      branchId: existing.branchId,
      userId: actor.userId,
      module: "JOB_CART",
      action: "COMPLETE",
      entityId: id,
      entityCode: existing.appointmentCode,
      entityName: existing.customer.name,
      description: `Job cart ${existing.appointmentCode} confirmed`,
      oldData: {
        appointmentStatus: existing.status,
        invoiceStatus: existing.invoice.status,
      },
      newData: {
        appointmentStatus: "COMPLETED",
        invoiceStatus: billing.status === "DRAFT" ? "DRAFT" : "ISSUED",
        manualDiscountAmount: manualDiscount,
        membershipDiscountAmount: membershipDiscount,
        ...(billing.payment
          ? { paymentMethod: billing.payment.method }
          : {}),
      },
      ...audit,
    });
    return present(await requireCart(tx, id, actor));
  });

export const cancelJobCart = async (
  actor: JobCartActor,
  id: string,
  audit: AuditContext
) =>
  prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Appointment" WHERE "id" = ${id} FOR UPDATE`;
    const existing = await requireCart(tx, id, actor);
    const invoice = existing.invoice;
    const status = mappedStatus(existing);
    const isCompletedRedemption =
      status === "COMPLETED" &&
      invoice?.status === "ISSUED" &&
      (await tx.customerPackageUsage.count({
        where: {
          invoiceId: invoice.id,
          jobCartAppointmentId: id,
          status: "USED",
        },
      })) > 0;
    if (!isCompletedRedemption) {
      requireMutable(existing);
    } else if (
      invoice.paymentStatus !== "UNPAID" ||
      invoice.paidAmount.gt(0)
    ) {
      throw new JobCartError(409, "Paid job carts cannot be cancelled");
    }
    const ledgerEntry = await tx.customerTransaction.findFirst({
      where: { invoiceId: existing.invoice!.id },
      select: { id: true },
    });
    if (ledgerEntry) {
      throw new JobCartError(
        409,
        "Job cart cannot be cancelled after ledger activity"
      );
    }
    if (isCompletedRedemption) {
      if (existing.invoice!.couponId) {
        await tx.$queryRaw`SELECT "id" FROM "Coupon" WHERE "id" = ${existing.invoice!.couponId} FOR UPDATE`;
        await tx.coupon.updateMany({
          where: {
            id: existing.invoice!.couponId,
            usedCount: { gt: 0 },
          },
          data: { usedCount: { decrement: 1 } },
        });
      }
      await reverseAppointmentConsumables({
        tx,
        appointmentId: id,
        salonId: existing.salonId,
        branchId: existing.branchId,
        createdById: actor.userId,
      });
      await reverseUsedPackageUsagesForInvoice(tx, {
        invoiceId: existing.invoice!.id,
        userId: actor.userId,
        ...audit,
      });
      await AppointmentModel.updateStatusWithHistory(
        id,
        {
          oldStatus: existing.status,
          newStatus: "CANCELLED",
          note: "Confirmed package redemption job cart cancelled",
          changedById: actor.userId,
        },
        tx
      );
      await InvoiceModel.cancel(existing.invoice!.id, tx);
      await createAuditLog({
        tx,
        salonId: existing.salonId,
        branchId: existing.branchId,
        userId: actor.userId,
        module: "JOB_CART",
        action: "CANCEL",
        entityId: id,
        entityCode: existing.appointmentCode,
        entityName: existing.customer.name,
        description: `Confirmed package redemption job cart ${existing.appointmentCode} cancelled`,
        oldData: {
          appointmentStatus: existing.status,
          invoiceStatus: existing.invoice!.status,
        },
        newData: {
          appointmentStatus: "CANCELLED",
          invoiceStatus: "CANCELLED",
        },
        ...audit,
      });
      return present(await requireCart(tx, id, actor));
    }
    const packageItems = existing.invoice!.items.filter(
      (item) => item.itemType === "PACKAGE"
    );
    if (packageItems.length) {
      await tx.invoiceItem.deleteMany({
        where: {
          id: { in: packageItems.map((item) => item.id) },
        },
      });
      for (const item of packageItems) {
        await createAuditLog({
          tx,
          salonId: existing.salonId,
          branchId: existing.branchId,
          userId: actor.userId,
          module: "JOB_CART",
          action: "DELETE",
          entityId: existing.id,
          entityCode: existing.appointmentCode,
          entityName: existing.customer.name,
          description: `Package ${item.serviceName} removed while cancelling job cart ${existing.appointmentCode}`,
          oldData: {
            itemId: item.id,
            packageId: item.packageId,
            price: item.unitPrice,
          },
          ...audit,
        });
      }
      await recalculateCart(tx, id, actor, audit);
    }
    const reservedUsages = await tx.customerPackageUsage.findMany({
      where: {
        jobCartAppointmentId: id,
        status: "RESERVED",
      },
      include: {
        items: {
          include: {
            appointmentServices: { select: { id: true } },
            invoiceItem: { select: { id: true } },
          },
        },
      },
    });
    for (const usage of reservedUsages) {
      await cancelReservedUsage(
        tx,
        usage,
        actor,
        audit,
        `Package redemption cancelled with job cart ${existing.appointmentCode}`
      );
    }
    if (reservedUsages.length) {
      await recalculateCart(tx, id, actor, audit);
    }
    await AppointmentModel.updateStatusWithHistory(
      id,
      {
        oldStatus: existing.status,
        newStatus: "CANCELLED",
        note: "Walk-in job cart cancelled",
        changedById: actor.userId,
      },
      tx
    );
    await InvoiceModel.cancel(existing.invoice!.id, tx);
    await createAuditLog({
      tx,
      salonId: existing.salonId,
      branchId: existing.branchId,
      userId: actor.userId,
      module: "JOB_CART",
      action: "CANCEL",
      entityId: id,
      entityCode: existing.appointmentCode,
      entityName: existing.customer.name,
      description: `Job cart ${existing.appointmentCode} cancelled`,
      oldData: {
        appointmentStatus: existing.status,
        invoiceStatus: existing.invoice!.status,
      },
      newData: {
        appointmentStatus: "CANCELLED",
        invoiceStatus: "CANCELLED",
      },
      ...audit,
    });
    return present(await requireCart(tx, id, actor));
  });
