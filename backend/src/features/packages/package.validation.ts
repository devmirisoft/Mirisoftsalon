import { z } from "zod";

const uuid = z.string().uuid();
const status = z.enum(["ACTIVE", "INACTIVE"]);
const packageType = z.enum(["STANDARD", "CUSTOMER_CUSTOM"]);
const positiveInteger = (fallback: number, maximum: number) =>
  z.preprocess(
    (value) => (value === undefined ? fallback : Number(value)),
    z.number().int().min(1).max(maximum)
  );

export const packageListSchema = z.object({
  page: positiveInteger(1, 1_000_000),
  limit: positiveInteger(20, 100),
  search: z.string().trim().max(120).optional(),
  status: status.optional(),
  type: packageType.optional(),
  categoryId: uuid.optional(),
  customerId: uuid.optional(),
  salonId: uuid.optional(),
  branchId: uuid.optional(),
});

export const categoryInputSchema = z.object({
  salonId: uuid.optional(),
  branchId: uuid.nullable().optional(),
  name: z.string().trim().min(1).max(120),
  status: status.optional(),
});

const packageItemSchema = z.object({
  serviceId: uuid,
  quantity: z.number().int().min(1).max(100).default(1),
});

const uniquePackageItems = (
  items: Array<{ serviceId: string }> | undefined
) =>
  !items?.length ||
  new Set(items.map((item) => item.serviceId)).size === items.length;

const servicePackageShape = {
  salonId: uuid.optional(),
  branchId: uuid.nullable().optional(),
  categoryId: uuid,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  specialPrice: z.coerce.number().finite().min(0),
  validityDays: z.coerce.number().int().positive().max(36500),
  status: status.optional(),
  items: z.array(packageItemSchema).min(1).max(100).optional(),
  serviceIds: z.array(uuid).min(1).max(100).optional(),
};

const requirePackageItems = (
  value: { items?: unknown[] | undefined; serviceIds?: string[] | undefined },
  context: z.RefinementCtx
) => {
  if (!value.items?.length && !value.serviceIds?.length) {
    context.addIssue({
      code: "custom",
      path: ["items"],
      message: "Package must contain at least one service",
    });
  }
};

export const servicePackageInputSchema = z
  .object(servicePackageShape)
  .superRefine(requirePackageItems);

export const updateServicePackageInputSchema = z
  .object({
    ...servicePackageShape,
    salonId: z.never().optional(),
  })
  .superRefine(requirePackageItems);

export const packageStatusSchema = z.object({ status });
export const customerPackageStatusSchema = z.object({
  status: z.enum(["ACTIVE", "EXPIRED", "USED", "CANCELLED"]),
});

export const customerCustomPackageListSchema = z.object({
  page: positiveInteger(1, 1_000_000),
  limit: positiveInteger(20, 100),
  search: z.string().trim().max(120).optional(),
  status: status.optional(),
  customerId: uuid.optional(),
  salonId: uuid.optional(),
  branchId: uuid.optional(),
});

export const createCustomPackageFromCartSchema = z
  .object({
    jobCartId: uuid,
    serviceIds: z
      .array(uuid)
      .min(1)
      .max(100)
      .refine(
        (serviceIds) => new Set(serviceIds).size === serviceIds.length,
        "Duplicate services are not allowed"
      )
      .optional(),
    items: z
      .array(packageItemSchema)
      .min(1)
      .max(100)
      .refine(uniquePackageItems, "Duplicate services are not allowed")
      .optional(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).nullable().optional(),
    specialPrice: z.coerce.number().finite().min(0),
    validityDays: z.coerce.number().int().positive().max(36500),
    soldByStaffId: uuid.optional(),
  })
  .superRefine(requirePackageItems);

export const copyCustomerCustomPackageSchema = z.object({
  sourcePackageId: uuid,
  targetCustomerId: uuid,
  branchId: uuid.optional(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  specialPrice: z.coerce.number().finite().min(0).optional(),
  validityDays: z.coerce.number().int().positive().max(36500).optional(),
  status: status.optional(),
});
