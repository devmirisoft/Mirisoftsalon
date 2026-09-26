import {
  Prisma,
  type InventoryLocation,
  type Product,
  type ProductStockMovementType,
} from "../../generated/prisma/client.js";
import { transactionError } from "../products/inventory-access.js";
import { syncStockLifecycleAfterMovement } from "./stockLifecycle.service.js";
import { createAuditLog } from "../audit-logs/audit-log.service.js";

type TransactionClient = Prisma.TransactionClient;

export const INVENTORY_LOCATIONS = ["WAREHOUSE", "RETAIL", "SERVICE"] as const;

export const LOCATION_LABELS: Record<InventoryLocation, string> = {
  WAREHOUSE: "Warehouse",
  RETAIL: "Retail",
  SERVICE: "Service",
};

export const isInventoryLocation = (value: unknown): value is InventoryLocation =>
  INVENTORY_LOCATIONS.includes(value as InventoryLocation);

/** Stands in for a null branch in unique keys: stock held at salon level. */
export const siteKeyOf = (branchId?: string | null) => branchId ?? "SALON";

/**
 * Where stock goes when a caller names no location, and where the locations
 * migration booked stock that existed before locations: the retail shelf for
 * products sold to customers, the service area for service-only products,
 * otherwise the warehouse.
 */
export const defaultLocation = (
  product: Pick<Product, "isRetailProduct" | "isServiceConsumable">
): InventoryLocation =>
  product.isRetailProduct
    ? "RETAIL"
    : product.isServiceConsumable
      ? "SERVICE"
      : "WAREHOUSE";

type CreateStockMovementInput = {
  tx: TransactionClient;
  salonId: string;
  branchId?: string;
  productId: string;
  type: ProductStockMovementType;
  quantity: Prisma.Decimal | number | string;
  /** Defaults to the location the type implies, then the product default. */
  location?: InventoryLocation;
  /** Set on the pack movements of an opened container (open, close, reopen). */
  containerId?: string;
  referenceType?: string;
  referenceId?: string;
  reason?: string;
  note?: string;
  createdById?: string;
  appointmentServiceId?: string;
  serviceId?: string;
  staffId?: string;
  expectedQuantity?: Prisma.Decimal;
};

const STOCK_IN_TYPES = new Set<ProductStockMovementType>([
  "STOCK_IN",
  "RETURNED",
]);

const STOCK_OUT_TYPES = new Set<ProductStockMovementType>([
  "STOCK_OUT",
  "RETAIL_SALE",
  "USED_IN_SERVICE",
  "DAMAGED",
  "WASTAGE",
  "LOST",
  // The pack of an opened container, once the container is closed.
  "CONTAINER_CLOSED",
]);

// A sale always leaves the retail shelf and service use the service area, so
// neither can quietly draw on warehouse stock.
const LOCATION_OF_TYPE: Partial<
  Record<ProductStockMovementType, InventoryLocation>
> = {
  RETAIL_SALE: "RETAIL",
  USED_IN_SERVICE: "SERVICE",
};

export const decimalQuantity = (value: Prisma.Decimal | number | string) => {
  try {
    const quantity = new Prisma.Decimal(value);
    if (!quantity.isFinite()) throw new Error("Invalid quantity");
    return quantity;
  } catch {
    throw transactionError("Quantity must be a valid number");
  }
};

/**
 * Quantities are stored with two decimals; a third would be rounded by the
 * database and a container would no longer add up to its movements.
 */
export const exactQuantity = (value: Prisma.Decimal | number | string) => {
  const quantity = decimalQuantity(value);
  if (quantity.decimalPlaces() > 2) {
    throw transactionError("Quantity can have at most 2 decimal places");
  }
  return quantity;
};

/**
 * 400 with enough detail for a client to offer a transfer: which location of
 * which branch ran short, and by how much.
 */
export const insufficientStock = (
  product: Pick<Product, "id" | "name">,
  branchId: string | null,
  location: InventoryLocation,
  available: Prisma.Decimal | number,
  needed: Prisma.Decimal | number
) =>
  Object.assign(
    new Error(
      `Insufficient stock for ${product.name} in ${LOCATION_LABELS[location]}: ${Number(available)} available, ${Number(needed)} needed`
    ),
    {
      status: 400,
      code: "INSUFFICIENT_STOCK",
      stock: {
        productId: product.id,
        branchId,
        location,
        available: Number(available),
        needed: Number(needed),
      },
    }
  );

/**
 * Takes the product row lock that every stock change for the product holds,
 * so location balances, containers and currentStock move together and two
 * requests can never spend the same stock. Stock written straight onto the
 * product (seed scripts, fixtures) is booked the way the locations migration
 * booked existing stock.
 */
export const lockProduct = async (
  tx: TransactionClient,
  salonId: string,
  productId: string
) => {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Product"
    WHERE "id" = ${productId}
      AND "salonId" = ${salonId}
    FOR UPDATE
  `;
  const product = await tx.product.findFirst({
    where: { id: productId, salonId },
  });
  if (!product) {
    throw transactionError("Product not found", 404);
  }
  if (
    !product.currentStock.isZero() &&
    (await tx.productLocationStock.count({ where: { productId } })) === 0
  ) {
    await tx.productLocationStock.create({
      data: {
        salonId,
        branchId: product.branchId,
        siteKey: siteKeyOf(product.branchId),
        productId,
        location: defaultLocation(product),
        quantity: product.currentStock,
      },
    });
  }
  return product;
};

/** Adds `delta` to one location balance; taking more than is there throws. */
export const changeLocationBalance = async (
  tx: TransactionClient,
  product: Product,
  branchId: string | null,
  location: InventoryLocation,
  delta: Prisma.Decimal
) => {
  const siteKey = siteKeyOf(branchId);
  const key = {
    productId_siteKey_location: { productId: product.id, siteKey, location },
  };
  if (delta.isNegative()) {
    const changed = await tx.productLocationStock.updateMany({
      where: {
        productId: product.id,
        siteKey,
        location,
        quantity: { gte: delta.abs() },
      },
      data: { quantity: { decrement: delta.abs() } },
    });
    if (changed.count !== 1) {
      const row = await tx.productLocationStock.findUnique({
        where: key,
        select: { quantity: true },
      });
      throw insufficientStock(
        product,
        branchId,
        location,
        row?.quantity ?? new Prisma.Decimal(0),
        delta.abs()
      );
    }
    return;
  }
  await tx.productLocationStock.upsert({
    where: key,
    create: {
      salonId: product.salonId,
      branchId,
      siteKey,
      productId: product.id,
      location,
      quantity: delta,
    },
    update: { quantity: { increment: delta } },
  });
};

type StockRow = {
  productId: string;
  branchId: string | null;
  location: InventoryLocation;
  quantity: Prisma.Decimal;
};

/**
 * Location balances for many products in one query, for reads that take no
 * lock. A product whose stock was never booked to a location reports it where
 * lockProduct will book it.
 */
export const locationStock = async (
  client: Pick<TransactionClient, "productLocationStock">,
  products: Array<
    Pick<
      Product,
      "id" | "branchId" | "currentStock" | "isRetailProduct" | "isServiceConsumable"
    >
  >
) => {
  const rows = products.length
    ? await client.productLocationStock.findMany({
        where: { productId: { in: products.map((product) => product.id) } },
        select: { productId: true, branchId: true, location: true, quantity: true },
      })
    : [];
  const byProduct = new Map<string, StockRow[]>();
  for (const row of rows) {
    byProduct.set(row.productId, [...(byProduct.get(row.productId) ?? []), row]);
  }
  for (const product of products) {
    if (!byProduct.has(product.id) && !product.currentStock.isZero()) {
      byProduct.set(product.id, [
        {
          productId: product.id,
          branchId: product.branchId,
          location: defaultLocation(product),
          quantity: product.currentStock,
        },
      ]);
    }
  }
  return {
    rows: (productId: string) => byProduct.get(productId) ?? [],
    /** Stock at one location of one branch (null = salon level). */
    at: (productId: string, branchId: string | null, location: InventoryLocation) =>
      (byProduct.get(productId) ?? [])
        .filter(
          (row) =>
            siteKeyOf(row.branchId) === siteKeyOf(branchId) &&
            row.location === location
        )
        .reduce((sum, row) => sum.plus(row.quantity), new Prisma.Decimal(0)),
  };
};

/** Packs of this product open at one location of one branch. */
export const openContainerCount = (
  tx: Pick<TransactionClient, "productContainer">,
  productId: string,
  branchId: string | null,
  location: InventoryLocation = "SERVICE"
) =>
  tx.productContainer.count({
    where: { productId, branchId, location, status: "OPEN" },
  });

/**
 * Sealed stock at a location: the balance minus the packs standing open there.
 * An open pack stays in stock until its container is closed, so it must not be
 * counted as something that can be moved or sold.
 */
export const assertSealedAvailable = async (
  tx: TransactionClient,
  product: Product,
  branchId: string | null,
  needed: Prisma.Decimal
) => {
  if (!product.packUnit || !product.packSize?.isPositive()) return;
  const [balance, open] = await Promise.all([
    tx.productLocationStock.findUnique({
      where: {
        productId_siteKey_location: {
          productId: product.id,
          siteKey: siteKeyOf(branchId),
          location: "SERVICE",
        },
      },
      select: { quantity: true },
    }),
    openContainerCount(tx, product.id, branchId),
  ]);
  const sealed = (balance?.quantity ?? new Prisma.Decimal(0)).minus(open);
  if (sealed.lessThan(needed)) {
    throw insufficientStock(product, branchId, "SERVICE", sealed, needed);
  }
};

/** Staff named on a stock event must work in the salon, and in the branch when there is one. */
export const assertStaffInBranch = async (
  tx: TransactionClient,
  salonId: string,
  branchId: string | null,
  staffId?: string
) => {
  if (!staffId) return;
  const staff = await tx.staff.findFirst({
    where: {
      id: staffId,
      salonId,
      ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
    },
    select: { id: true },
  });
  if (!staff) {
    throw transactionError("Staff member not found in this branch", 404);
  }
};

export const createStockMovement = async (
  input: CreateStockMovementInput
) => {
  const quantity = decimalQuantity(input.quantity);

  if (
    quantity.isZero() ||
    (input.type !== "ADJUSTMENT" && quantity.isNegative())
  ) {
    throw transactionError(
      "Quantity must be positive; adjustments may be positive or negative"
    );
  }

  const product = await lockProduct(input.tx, input.salonId, input.productId);

  if (input.branchId) {
    const branch = await input.tx.branch.findFirst({
      where: {
        id: input.branchId,
        salonId: input.salonId,
      },
      select: { id: true },
    });

    if (!branch) {
      throw transactionError("Invalid branch for this salon");
    }

    if (product.branchId && product.branchId !== input.branchId) {
      throw transactionError("Product does not belong to the selected branch");
    }
  }

  if (input.referenceType && input.referenceId) {
    const existingMovement = await input.tx.productStockMovement.findFirst({
      where: {
        salonId: input.salonId,
        productId: input.productId,
        type: input.type,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        containerId: input.containerId ?? null,
        appointmentServiceId: input.appointmentServiceId ?? null,
      },
    });

    if (existingMovement) {
      return {
        product,
        movement: existingMovement,
        duplicate: true,
      };
    }
  }

  const isAdjustment = input.type === "ADJUSTMENT";
  const isStockIn = STOCK_IN_TYPES.has(input.type) ||
    (isAdjustment && quantity.isPositive());
  const isStockOut = STOCK_OUT_TYPES.has(input.type) ||
    (isAdjustment && quantity.isNegative());

  if (!isStockIn && !isStockOut) {
    throw transactionError("Unsupported stock movement type");
  }

  const branchId = input.branchId ?? product.branchId;
  const location =
    input.location ?? LOCATION_OF_TYPE[input.type] ?? defaultLocation(product);
  const stockBefore = product.currentStock;
  const delta = isStockOut ? quantity.abs().negated() : quantity.abs();

  // Packs that are already open are still in the service balance but cannot be
  // moved, sold or written off as sealed stock; only closing the container
  // takes them out.
  if (isStockOut && location === "SERVICE" && input.type !== "CONTAINER_CLOSED") {
    await assertSealedAvailable(input.tx, product, branchId, quantity.abs());
  }
  await changeLocationBalance(input.tx, product, branchId, location, delta);
  const updatedProduct = await input.tx.product.update({
    where: { id: input.productId },
    data: { currentStock: { increment: delta } },
  });

  const movement = await input.tx.productStockMovement.create({
    data: {
      salonId: input.salonId,
      branchId,
      productId: input.productId,
      type: input.type,
      quantity,
      stockBefore,
      stockAfter: updatedProduct.currentStock,
      location,
      unit: product.unit,
      ...(input.containerId ? { containerId: input.containerId } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.note ? { note: input.note } : {}),
      ...(input.referenceType ? { referenceType: input.referenceType } : {}),
      ...(input.referenceId ? { referenceId: input.referenceId } : {}),
      ...(input.createdById ? { createdById: input.createdById } : {}),
      ...(input.appointmentServiceId
        ? { appointmentServiceId: input.appointmentServiceId }
        : {}),
      ...(input.serviceId ? { serviceId: input.serviceId } : {}),
      ...(input.staffId ? { staffId: input.staffId } : {}),
      ...(input.expectedQuantity
        ? { expectedQuantity: input.expectedQuantity }
        : {}),
    },
  });

  await createAuditLog({
    tx: input.tx,
    salonId: input.salonId,
    branchId,
    userId: input.createdById,
    module: "INVENTORY",
    action: "STOCK_MOVEMENT",
    entityId: movement.id,
    entityCode: input.referenceId,
    entityName: updatedProduct.name,
    description: `${input.type} stock movement recorded for ${updatedProduct.name}`,
    oldData: { currentStock: stockBefore },
    newData: {
      type: input.type,
      quantity,
      location,
      currentStock: updatedProduct.currentStock,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      reason: input.reason,
      appointmentServiceId: input.appointmentServiceId,
      staffId: input.staffId,
    },
  });

  await syncStockLifecycleAfterMovement(
    input.tx,
    input.productId,
    input.salonId,
    branchId ?? undefined
  );

  return {
    product: updatedProduct,
    movement,
    duplicate: false,
  };
};

type TransferStockInput = {
  tx: TransactionClient;
  salonId: string;
  productId: string;
  quantity: Prisma.Decimal | number | string;
  /** null = salon-level stock. */
  fromBranchId: string | null;
  fromLocation: InventoryLocation;
  toBranchId: string | null;
  toLocation: InventoryLocation;
  issuedByStaffId?: string;
  receivedByStaffId?: string;
  note?: string;
  /** Client-generated per submit, so a double click moves stock once. */
  requestId?: string;
  createdById?: string;
};

/**
 * Moves sealed stock between two locations of one branch, or from salon-level
 * stock into a branch. The product total does not change.
 */
export const transferStock = async (input: TransferStockInput) => {
  const quantity = exactQuantity(input.quantity);
  if (!quantity.isPositive()) {
    throw transactionError("Transfer quantity must be positive");
  }
  const sameSite = siteKeyOf(input.fromBranchId) === siteKeyOf(input.toBranchId);
  if (sameSite && input.fromLocation === input.toLocation) {
    throw transactionError("Choose two different locations");
  }
  if (!sameSite && input.fromBranchId) {
    throw transactionError(
      "Stock can move between locations of one branch, or from salon-level stock into a branch"
    );
  }

  const product = await lockProduct(input.tx, input.salonId, input.productId);
  if (
    product.branchId &&
    [input.fromBranchId, input.toBranchId].some(
      (branchId) => branchId !== product.branchId
    )
  ) {
    throw transactionError("Product does not belong to the selected branch");
  }
  if (input.fromLocation === "SERVICE") {
    await assertSealedAvailable(input.tx, product, input.fromBranchId, quantity);
  }
  if (input.toBranchId) {
    const branch = await input.tx.branch.findFirst({
      where: { id: input.toBranchId, salonId: input.salonId },
      select: { id: true },
    });
    if (!branch) throw transactionError("Invalid branch for this salon");
  }

  if (input.requestId) {
    const existing = await input.tx.productStockMovement.findFirst({
      where: {
        salonId: input.salonId,
        productId: input.productId,
        type: "TRANSFER",
        referenceType: "TRANSFER",
        referenceId: input.requestId,
      },
    });
    if (existing) return { product, movement: existing, duplicate: true };
  }

  await assertStaffInBranch(input.tx, input.salonId, input.toBranchId, input.issuedByStaffId);
  await assertStaffInBranch(input.tx, input.salonId, input.toBranchId, input.receivedByStaffId);

  await changeLocationBalance(
    input.tx,
    product,
    input.fromBranchId,
    input.fromLocation,
    quantity.negated()
  );
  await changeLocationBalance(
    input.tx,
    product,
    input.toBranchId,
    input.toLocation,
    quantity
  );

  const movement = await input.tx.productStockMovement.create({
    data: {
      salonId: input.salonId,
      branchId: input.fromBranchId,
      productId: product.id,
      type: "TRANSFER",
      quantity,
      stockBefore: product.currentStock,
      stockAfter: product.currentStock,
      location: input.fromLocation,
      toLocation: input.toLocation,
      unit: product.unit,
      ...(sameSite ? {} : { toBranchId: input.toBranchId }),
      referenceType: "TRANSFER",
      ...(input.requestId ? { referenceId: input.requestId } : {}),
      ...(input.note ? { note: input.note } : {}),
      ...(input.issuedByStaffId ? { staffId: input.issuedByStaffId } : {}),
      ...(input.receivedByStaffId
        ? { receivedByStaffId: input.receivedByStaffId }
        : {}),
      ...(input.createdById ? { createdById: input.createdById } : {}),
    },
  });

  await createAuditLog({
    tx: input.tx,
    salonId: input.salonId,
    branchId: input.toBranchId ?? input.fromBranchId,
    userId: input.createdById,
    module: "INVENTORY",
    action: "STOCK_MOVEMENT",
    entityId: movement.id,
    entityName: product.name,
    description: `${quantity} ${product.unit} of ${product.name} transferred from ${LOCATION_LABELS[input.fromLocation]} to ${LOCATION_LABELS[input.toLocation]}`,
    newData: {
      type: "TRANSFER",
      quantity,
      fromBranchId: input.fromBranchId,
      fromLocation: input.fromLocation,
      toBranchId: input.toBranchId,
      toLocation: input.toLocation,
      issuedByStaffId: input.issuedByStaffId,
      receivedByStaffId: input.receivedByStaffId,
    },
  });

  return { product, movement, duplicate: false };
};
