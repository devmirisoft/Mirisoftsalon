import { z } from "zod";

const uuid = z.string().uuid();
const phone = z
  .string()
  .trim()
  .min(7)
  .max(24)
  .refine((value) => /^\+?[\d\s()-]+$/.test(value), "Invalid phone number")
  .refine((value) => {
    const digits = value.replace(/\D/g, "").length;
    return digits >= 7 && digits <= 15;
  }, "Phone number must contain 7 to 15 digits");

export const createJobCartSchema = z.object({
  salonId: uuid.optional(),
  branchId: uuid,
  customerName: z.string().trim().min(2).max(120),
  phone,
  startTime: z.iso.datetime({ offset: true }).optional(),
  staffId: uuid.optional(),
  serviceIds: z.array(uuid).max(30).default([]),
  serviceItems: z
    .array(
      z.object({
        serviceId: uuid,
        staffId: uuid.optional(),
      })
    )
    .max(30)
    .optional(),
  bookingNote: z.string().trim().max(1000).optional(),
  internalNote: z.string().trim().max(1000).optional(),
}).superRefine((value, context) => {
  const serviceIds = value.serviceItems?.map((item) => item.serviceId) ?? value.serviceIds;
  if (new Set(serviceIds).size !== serviceIds.length) {
    context.addIssue({
      code: "custom",
      path: [value.serviceItems ? "serviceItems" : "serviceIds"],
      message: "Duplicate services are not allowed",
    });
  }
});

export const updateJobCartSchema = z
  .object({
    customerName: z.string().trim().min(2).max(120).optional(),
    phone: phone.optional(),
    startTime: z.iso.datetime({ offset: true }).optional(),
    staffId: uuid.nullable().optional(),
    bookingNote: z.string().trim().max(1000).nullable().optional(),
    internalNote: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export const addJobCartItemSchema = z
  .object({
    itemType: z
      .enum(["SERVICE", "PACKAGE", "PRODUCT", "MEMBERSHIP"])
      .default("SERVICE"),
    serviceId: uuid.optional(),
    packageId: uuid.optional(),
    productId: uuid.optional(),
    membershipId: uuid.optional(),
    quantity: z.coerce.number().int().positive().max(999).optional(),
    staffId: uuid.optional(),
  })
  .superRefine((value, context) => {
    if (value.itemType === "SERVICE" && !value.serviceId) {
      context.addIssue({
        code: "custom",
        path: ["serviceId"],
        message: "serviceId is required for a service item",
      });
    }
    if (value.itemType === "PACKAGE" && !value.packageId) {
      context.addIssue({
        code: "custom",
        path: ["packageId"],
        message: "packageId is required for a package item",
      });
    }
    if (value.itemType === "PRODUCT" && !value.productId) {
      context.addIssue({
        code: "custom",
        path: ["productId"],
        message: "productId is required for a product item",
      });
    }
    if (value.itemType === "MEMBERSHIP" && !value.membershipId) {
      context.addIssue({
        code: "custom",
        path: ["membershipId"],
        message: "membershipId is required for a membership item",
      });
    }
  });

export const updateJobCartItemSchema = z
  .object({
    price: z.coerce.number().min(0).max(10_000_000).optional(),
    staffId: uuid.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export const customerSummarySchema = z
  .object({
    customerId: uuid.optional(),
    phone: z.string().trim().min(7).max(24).optional(),
  })
  .refine((value) => value.customerId || value.phone, {
    message: "customerId or phone is required",
  });

export const addPackageRedemptionSchema = z.object({
  customerPackageId: uuid,
  items: z
    .array(
      z.object({
        serviceId: uuid,
        quantity: z.coerce.number().int().positive().max(100),
        staffId: uuid.optional(),
      })
    )
    .min(1)
    .max(100)
    .refine(
      (items) =>
        new Set(items.map((item) => item.serviceId)).size === items.length,
      "Duplicate package services are not allowed"
    ),
});

const positiveInteger = (fallback: number, maximum: number) =>
  z.preprocess(
    (value) => (value === undefined ? fallback : Number(value)),
    z.number().int().min(1).max(maximum)
  );

export const listJobCartsSchema = z.object({
  page: positiveInteger(1, 1_000_000),
  limit: positiveInteger(20, 100),
  salonId: uuid.optional(),
  branchId: uuid.optional(),
  customerId: uuid.optional(),
  search: z.string().trim().max(120).optional(),
  customerName: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(24).optional(),
  status: z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]).optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  createdById: uuid.optional(),
});
