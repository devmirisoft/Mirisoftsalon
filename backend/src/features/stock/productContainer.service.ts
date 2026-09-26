import {
  Prisma,
  type Product,
  type ProductContainer,
} from "../../generated/prisma/client.js";
import { transactionError } from "../products/inventory-access.js";
import { createAuditLog } from "../audit-logs/audit-log.service.js";
import { syncStockLifecycleAfterMovement } from "./stockLifecycle.service.js";
import {
  assertSealedAvailable,
  assertStaffInBranch,
  createStockMovement,
  exactQuantity,
  lockProduct,
  siteKeyOf,
} from "./stockMovement.service.js";

type TransactionClient = Prisma.TransactionClient;

/** A product with a pack size is opened into containers for service use. */
export const isContainerTracked = (
  product: Pick<Product, "packSize" | "packUnit">
) => Boolean(product.packUnit && product.packSize?.isPositive());

// "Shampoo" -> "SH-001": two letters of the name, numbered per product.
const containerCode = (productName: string, sequence: number) =>
  `${(productName.toUpperCase().replace(/[^A-Z0-9]/g, "") + "PK").slice(0, 2)}-${String(sequence).padStart(3, "0")}`;

type OpenContainersInput = {
  tx: TransactionClient;
  salonId: string;
  productId: string;
  /** Service area of this branch; null = salon level, undefined = the product's branch. */
  branchId?: string | null;
  count?: number;
  openedByStaffId?: string;
  reason?: string;
  requestId?: string;
  createdById?: string;
};

/**
 * Starts a tracked container for each of `count` sealed packs. Opening is not
 * consumption: the pack stays in Service stock, and in the product total,
 * until its container is closed. Always allowed while sealed stock remains,
 * whatever is already open.
 */
export const openContainers = async (input: OpenContainersInput) => {
  const count = input.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw transactionError("Open between 1 and 50 packs at a time");
  }
  const product = await lockProduct(input.tx, input.salonId, input.productId);
  if (!isContainerTracked(product)) {
    throw transactionError(
      `Set a pack size on ${product.name} before opening packs`
    );
  }
  const branchId =
    input.branchId === undefined ? product.branchId : input.branchId;
  if (product.branchId && branchId !== product.branchId) {
    throw transactionError("Product does not belong to the selected branch");
  }
  if (branchId) {
    const branch = await input.tx.branch.findFirst({
      where: { id: branchId, salonId: input.salonId },
      select: { id: true },
    });
    if (!branch) throw transactionError("Invalid branch for this salon");
  }

  if (input.requestId) {
    const earlier = await input.tx.productStockMovement.findMany({
      where: {
        salonId: input.salonId,
        productId: product.id,
        type: "OPEN_CONTAINER",
        referenceType: "OPEN_CONTAINER",
        referenceId: input.requestId,
      },
      select: { container: true },
    });
    if (earlier.length) {
      return {
        product,
        containers: earlier.map((row) => row.container!),
        duplicate: true,
      };
    }
  }

  await assertStaffInBranch(input.tx, input.salonId, branchId, input.openedByStaffId);
  await assertSealedAvailable(
    input.tx,
    product,
    branchId,
    new Prisma.Decimal(count)
  );

  const numbered = await input.tx.productContainer.count({
    where: { productId: product.id },
  });
  const containers: ProductContainer[] = [];
  const stock = product.currentStock;
  for (let index = 0; index < count; index += 1) {
    const container = await input.tx.productContainer.create({
      data: {
        code: containerCode(product.name, numbered + index + 1),
        salonId: input.salonId,
        branchId,
        productId: product.id,
        location: "SERVICE",
        originalQuantity: product.packSize!,
        remainingQuantity: product.packSize!,
        unit: product.packUnit!,
        status: "OPEN",
        ...(input.openedByStaffId
          ? { openedByStaffId: input.openedByStaffId }
          : {}),
        ...(input.createdById ? { openedById: input.createdById } : {}),
      },
    });
    const movement = await input.tx.productStockMovement.create({
      data: {
        salonId: input.salonId,
        branchId,
        productId: product.id,
        type: "OPEN_CONTAINER",
        quantity: 1,
        // Nothing leaves stock here: the pack is now open rather than sealed.
        stockBefore: stock,
        stockAfter: stock,
        location: "SERVICE",
        unit: product.unit,
        containerId: container.id,
        referenceType: "OPEN_CONTAINER",
        ...(input.requestId ? { referenceId: input.requestId } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.openedByStaffId ? { staffId: input.openedByStaffId } : {}),
        ...(input.createdById ? { createdById: input.createdById } : {}),
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
      entityCode: container.code,
      entityName: product.name,
      description: `${product.name} pack ${container.code} opened`,
      newData: {
        type: "OPEN_CONTAINER",
        containerId: container.id,
        code: container.code,
        quantity: container.originalQuantity,
        unit: container.unit,
        openedByStaffId: input.openedByStaffId,
        reason: input.reason,
      },
    });
    containers.push(container);
  }

  return { product, containers, duplicate: false };
};

type ContainerMovementType =
  | "USED_IN_SERVICE"
  | "RETURNED"
  | "WASTAGE"
  | "LOST"
  | "DAMAGED"
  | "ADJUSTMENT";

type MoveContainerContentInput = {
  tx: TransactionClient;
  salonId: string;
  containerId: string;
  type: ContainerMovementType;
  /** In the container unit; signed only for ADJUSTMENT. */
  quantity: Prisma.Decimal | number | string;
  /** When given, the container must be in this branch (null = salon level). */
  branchId?: string | null;
  /** When given, the container must hold this product. */
  productId?: string;
  /** Status to close with when the content reaches zero (a write-off). */
  closeAs?: "LOST" | "DAMAGED";
  referenceType?: string;
  referenceId?: string;
  appointmentServiceId?: string;
  serviceId?: string;
  staffId?: string;
  expectedQuantity?: Prisma.Decimal;
  reason?: string;
  note?: string;
  createdById?: string;
};

const containerShort = (
  product: Pick<Product, "id" | "name">,
  container: ProductContainer,
  needed: Prisma.Decimal
) =>
  Object.assign(
    new Error(
      `${container.code} has only ${Number(container.remainingQuantity)} ${container.unit} of ${product.name} left; ${Number(needed)} ${container.unit} needed`
    ),
    {
      status: 400,
      code: "INSUFFICIENT_OPEN_STOCK",
      stock: {
        productId: product.id,
        containerId: container.id,
        available: Number(container.remainingQuantity),
        needed: Number(needed),
        unit: container.unit,
      },
    }
  );

/** One pack of an opened container leaves stock: used up, lost or damaged. */
const releasePack = (
  input: MoveContainerContentInput,
  product: Product,
  container: ProductContainer,
  status: string
) =>
  createStockMovement({
    tx: input.tx,
    salonId: input.salonId,
    ...(container.branchId ? { branchId: container.branchId } : {}),
    productId: product.id,
    type: "CONTAINER_CLOSED",
    quantity: 1,
    location: container.location,
    containerId: container.id,
    reason: `${container.code} closed as ${status.toLowerCase()}`,
    ...(input.createdById ? { createdById: input.createdById } : {}),
  });

/** A closed container that holds content again takes its pack back. */
const reclaimPack = (
  input: MoveContainerContentInput,
  product: Product,
  container: ProductContainer
) =>
  createStockMovement({
    tx: input.tx,
    salonId: input.salonId,
    ...(container.branchId ? { branchId: container.branchId } : {}),
    productId: product.id,
    type: "RETURNED",
    quantity: 1,
    location: container.location,
    containerId: container.id,
    reason: `${container.code} reopened`,
    ...(input.createdById ? { createdById: input.createdById } : {}),
  });

/**
 * Changes what is left in one container. The remaining quantity is only ever
 * moved here, together with the movement that explains it.
 */
export const moveContainerContent = async (
  input: MoveContainerContentInput
) => {
  const quantity = exactQuantity(input.quantity);
  if (
    quantity.isZero() ||
    (input.type !== "ADJUSTMENT" && quantity.isNegative())
  ) {
    throw transactionError(
      "Quantity must be positive; adjustments may be positive or negative"
    );
  }
  const found = await input.tx.productContainer.findFirst({
    where: { id: input.containerId, salonId: input.salonId },
    select: { productId: true },
  });
  if (!found) throw transactionError("Container not found", 404);
  if (input.productId && input.productId !== found.productId) {
    throw transactionError("That container holds a different product");
  }
  const product = await lockProduct(input.tx, input.salonId, found.productId);
  const container = await input.tx.productContainer.findUniqueOrThrow({
    where: { id: input.containerId },
  });
  if (
    input.branchId !== undefined &&
    siteKeyOf(container.branchId) !== siteKeyOf(input.branchId)
  ) {
    throw transactionError(`${container.code} is not in this branch`);
  }

  if (input.referenceType && input.referenceId) {
    const existing = await input.tx.productStockMovement.findFirst({
      where: {
        containerId: container.id,
        type: input.type,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        appointmentServiceId: input.appointmentServiceId ?? null,
      },
    });
    if (existing) return { container, movement: existing, duplicate: true };
  }

  const adds =
    input.type === "RETURNED" ||
    (input.type === "ADJUSTMENT" && quantity.isPositive());
  const delta = adds ? quantity.abs() : quantity.abs().negated();
  if (delta.isNegative()) {
    if (container.status !== "OPEN") {
      throw transactionError(
        `${container.code} is ${container.status.toLowerCase()} and cannot be used`
      );
    }
    if (container.remainingQuantity.lt(delta.abs())) {
      throw containerShort(product, container, delta.abs());
    }
  }
  const remaining = container.remainingQuantity.plus(delta);
  if (remaining.gt(container.originalQuantity)) {
    throw transactionError(
      `${container.code} holds at most ${Number(container.originalQuantity)} ${container.unit}`
    );
  }
  const status = remaining.isZero()
    ? container.status === "OPEN"
      ? (input.closeAs ?? "EMPTY")
      : container.status
    : container.status === "EMPTY"
      ? "OPEN"
      : container.status;
  const updated = await input.tx.productContainer.update({
    where: { id: container.id },
    data: {
      remainingQuantity: remaining,
      status,
      closedAt: status === "OPEN" ? null : (container.closedAt ?? new Date()),
    },
  });
  // The pack itself leaves stock when the container closes, and comes back if
  // the container is reopened, so an open pack is counted exactly once.
  if (container.status === "OPEN" && status !== "OPEN") {
    await releasePack(input, product, container, status);
  } else if (container.status !== "OPEN" && status === "OPEN") {
    await reclaimPack(input, product, container);
  }

  const movement = await input.tx.productStockMovement.create({
    data: {
      salonId: input.salonId,
      branchId: container.branchId,
      productId: product.id,
      type: input.type,
      quantity: input.type === "ADJUSTMENT" ? quantity : quantity.abs(),
      stockBefore: container.remainingQuantity,
      stockAfter: remaining,
      location: container.location,
      // The unit this was measured in, whatever the product carries later.
      unit: container.unit,
      containerId: container.id,
      ...(input.referenceType ? { referenceType: input.referenceType } : {}),
      ...(input.referenceId ? { referenceId: input.referenceId } : {}),
      ...(input.appointmentServiceId
        ? { appointmentServiceId: input.appointmentServiceId }
        : {}),
      ...(input.serviceId ? { serviceId: input.serviceId } : {}),
      ...(input.staffId ? { staffId: input.staffId } : {}),
      ...(input.expectedQuantity
        ? { expectedQuantity: input.expectedQuantity }
        : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.note ? { note: input.note } : {}),
      ...(input.createdById ? { createdById: input.createdById } : {}),
    },
  });

  await createAuditLog({
    tx: input.tx,
    salonId: input.salonId,
    branchId: container.branchId,
    userId: input.createdById,
    module: "INVENTORY",
    action: "STOCK_MOVEMENT",
    entityId: movement.id,
    entityCode: container.code,
    entityName: product.name,
    description: `${input.type} of ${Number(quantity.abs())} ${container.unit} recorded on ${product.name} ${container.code}`,
    oldData: {
      remainingQuantity: container.remainingQuantity,
      status: container.status,
    },
    newData: {
      type: input.type,
      quantity,
      remainingQuantity: remaining,
      status,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      appointmentServiceId: input.appointmentServiceId,
      staffId: input.staffId,
      reason: input.reason,
    },
  });

  return { container: updated, movement, duplicate: false };
};

/**
 * Takes `quantity` from the open containers of one branch service area,
 * oldest first, spilling into the next container when one runs dry.
 */
export const consumeFromOpenContainers = async (
  input: Omit<MoveContainerContentInput, "containerId" | "type" | "quantity"> & {
    product: Pick<Product, "id" | "name" | "packUnit">;
    branchId: string | null;
    quantity: Prisma.Decimal;
  }
) => {
  await lockProduct(input.tx, input.salonId, input.product.id);
  const containers = await input.tx.productContainer.findMany({
    where: {
      productId: input.product.id,
      branchId: input.branchId,
      location: "SERVICE",
      status: "OPEN",
      remainingQuantity: { gt: 0 },
    },
    orderBy: [{ openedAt: "asc" }, { code: "asc" }],
  });
  const available = containers.reduce(
    (sum, container) => sum.plus(container.remainingQuantity),
    new Prisma.Decimal(0)
  );
  if (available.lt(input.quantity)) {
    throw Object.assign(
      new Error(
        `Not enough open ${input.product.name} in Service: ${Number(available)} ${input.product.packUnit} in open packs, ${Number(input.quantity)} ${input.product.packUnit} needed. Open a new pack.`
      ),
      {
        status: 400,
        code: "INSUFFICIENT_OPEN_STOCK",
        stock: {
          productId: input.product.id,
          branchId: input.branchId,
          location: "SERVICE",
          available: Number(available),
          needed: Number(input.quantity),
          unit: input.product.packUnit,
        },
      }
    );
  }
  const { product: _product, quantity, ...rest } = input;
  let left = quantity;
  for (const container of containers) {
    if (left.isZero()) break;
    const take = Prisma.Decimal.min(left, container.remainingQuantity);
    await moveContainerContent({
      ...rest,
      containerId: container.id,
      type: "USED_IN_SERVICE",
      quantity: take,
    });
    left = left.minus(take);
  }
};

export const RECONCILE_REASONS = {
  WASTAGE: { type: "WASTAGE", label: "Wastage" },
  SPILLAGE: { type: "WASTAGE", label: "Spillage" },
  LOST: { type: "LOST", label: "Lost" },
  DAMAGED: { type: "DAMAGED", label: "Damaged" },
  INCORRECT_USAGE: { type: "ADJUSTMENT", label: "Incorrect previous usage" },
  MEASUREMENT: { type: "ADJUSTMENT", label: "Measurement adjustment" },
  OTHER: { type: "ADJUSTMENT", label: "Other" },
} as const;

export type ReconcileReason = keyof typeof RECONCILE_REASONS;

/**
 * Records the gap between what the system expects in a container and what a
 * physical check found. The gap is booked under the reason given, never as
 * service usage.
 */
export const reconcileContainer = async (input: {
  tx: TransactionClient;
  salonId: string;
  containerId: string;
  actualRemaining: Prisma.Decimal | number | string;
  reason: ReconcileReason;
  note?: string;
  requestId?: string;
  createdById?: string;
  branchId?: string | null;
}) => {
  const reason = RECONCILE_REASONS[input.reason];
  if (!reason) throw transactionError("Choose a reconciliation reason");
  const actual = exactQuantity(input.actualRemaining);
  if (actual.isNegative()) {
    throw transactionError("Actual remaining cannot be negative");
  }
  const found = await input.tx.productContainer.findFirst({
    where: { id: input.containerId, salonId: input.salonId },
    select: { productId: true },
  });
  if (!found) throw transactionError("Container not found", 404);
  await lockProduct(input.tx, input.salonId, found.productId);
  const container = await input.tx.productContainer.findUniqueOrThrow({
    where: { id: input.containerId },
  });
  if (input.requestId) {
    const existing = await input.tx.productStockMovement.findFirst({
      where: {
        containerId: container.id,
        referenceType: "RECONCILE",
        referenceId: input.requestId,
      },
    });
    if (existing) return { container, movement: existing, duplicate: true };
  }
  if (actual.gt(container.originalQuantity)) {
    throw transactionError(
      `${container.code} holds at most ${Number(container.originalQuantity)} ${container.unit}`
    );
  }
  const difference = actual.minus(container.remainingQuantity);
  if (difference.isZero()) {
    throw transactionError(
      "Actual remaining matches the system; there is nothing to record"
    );
  }
  if (difference.isPositive() && reason.type !== "ADJUSTMENT") {
    throw transactionError(
      "More than expected can only be recorded as an adjustment"
    );
  }
  return moveContainerContent({
    tx: input.tx,
    salonId: input.salonId,
    containerId: container.id,
    type: reason.type,
    quantity: reason.type === "ADJUSTMENT" ? difference : difference.abs(),
    ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
    ...(reason.type === "LOST" || reason.type === "DAMAGED"
      ? { closeAs: reason.type }
      : {}),
    referenceType: "RECONCILE",
    ...(input.requestId ? { referenceId: input.requestId } : {}),
    reason: reason.label,
    ...(input.note ? { note: input.note } : {}),
    ...(input.createdById ? { createdById: input.createdById } : {}),
  });
};
