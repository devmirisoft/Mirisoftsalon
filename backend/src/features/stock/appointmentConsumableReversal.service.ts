import { Prisma, type InventoryLocation } from "../../generated/prisma/client.js";
import { createAuditLog } from "../audit-logs/audit-log.service.js";
import { createStockMovement } from "./stockMovement.service.js";
import { moveContainerContent } from "./productContainer.service.js";

type TransactionClient = Prisma.TransactionClient;

/**
 * Puts back what a completed appointment used: sealed stock to the location it
 * left, container content to the container it came from.
 *
 * Reversal policy for containers, so a cancellation is never blocked by what
 * happened to a pack afterwards:
 *  - open or empty: the content goes back; an empty pack is reopened and
 *    counts as stock again.
 *  - refilled since (an adjustment put content back): only what fits is
 *    restored, and the movement note says how much could not be.
 *  - written off as lost or damaged: nothing is restored, and the attempt is
 *    recorded in the audit log instead.
 */
export const reverseAppointmentConsumables = async (input: {
  tx: TransactionClient;
  appointmentId: string;
  salonId: string;
  branchId?: string | null | undefined;
  createdById?: string | undefined;
}) => {
  await input.tx.$queryRaw`
    SELECT "id"
    FROM "Appointment"
    WHERE "id" = ${input.appointmentId}
      AND "salonId" = ${input.salonId}
    FOR UPDATE
  `;

  const deductions = await input.tx.productStockMovement.findMany({
    where: {
      salonId: input.salonId,
      type: "USED_IN_SERVICE",
      referenceType: "APPOINTMENT",
      referenceId: input.appointmentId,
    },
    orderBy: [{ productId: "asc" }, { createdAt: "asc" }],
  });

  // One reversal per product and container, so a restore never lands in a
  // different container than the use it undoes.
  const groups = new Map<
    string,
    {
      productId: string;
      containerId: string | null;
      branchId: string | null;
      location: InventoryLocation | null;
      quantity: Prisma.Decimal;
      movementIds: string[];
    }
  >();
  for (const deduction of deductions) {
    const key = `${deduction.productId}:${deduction.containerId ?? ""}`;
    const existing = groups.get(key);
    if (existing) {
      existing.quantity = existing.quantity.add(deduction.quantity);
      existing.movementIds.push(deduction.id);
    } else {
      groups.set(key, {
        productId: deduction.productId,
        containerId: deduction.containerId,
        branchId: deduction.branchId,
        location: deduction.location,
        quantity: deduction.quantity,
        movementIds: [deduction.id],
      });
    }
  }

  let reversed = 0;
  let duplicates = 0;
  let skipped = 0;
  for (const group of groups.values()) {
    const common = {
      tx: input.tx,
      salonId: input.salonId,
      type: "RETURNED" as const,
      referenceType: "APPOINTMENT_CONSUMABLE_REVERSAL",
      referenceId: input.appointmentId,
      reason: "Reversed consumables for cancelled completed appointment",
      ...(input.createdById ? { createdById: input.createdById } : {}),
    };
    const note = `Reversal of service-consumable movement(s) ${group.movementIds.join(", ")}`;
    const branchId = input.branchId ?? group.branchId;

    if (!group.containerId) {
      const result = await createStockMovement({
        ...common,
        quantity: group.quantity,
        note,
        ...(branchId ? { branchId } : {}),
        productId: group.productId,
        // Rows from before locations came out of the one shared pool, which
        // served the service area.
        location: group.location ?? "SERVICE",
      });
      if (result.duplicate) duplicates += 1;
      else reversed += 1;
      continue;
    }

    const container = await input.tx.productContainer.findUnique({
      where: { id: group.containerId },
    });
    const room = container
      ? container.originalQuantity.minus(container.remainingQuantity)
      : new Prisma.Decimal(0);
    const restore = Prisma.Decimal.min(group.quantity, room);
    const writtenOff =
      !container || container.status === "LOST" || container.status === "DAMAGED";
    if (writtenOff || restore.lessThanOrEqualTo(0)) {
      skipped += 1;
      await createAuditLog({
        tx: input.tx,
        salonId: input.salonId,
        branchId,
        userId: input.createdById,
        module: "INVENTORY",
        action: "STOCK_MOVEMENT",
        entityId: group.containerId,
        entityCode: container?.code,
        description: `${Number(group.quantity)} ${container?.unit ?? ""} could not be restored to ${container?.code ?? "a container"}: it is ${container ? container.status.toLowerCase() : "missing"}`.trim(),
        newData: {
          appointmentId: input.appointmentId,
          containerId: group.containerId,
          quantity: group.quantity,
          status: container?.status ?? null,
        },
      });
      continue;
    }

    const shortfall = group.quantity.minus(restore);
    const result = await moveContainerContent({
      ...common,
      containerId: group.containerId,
      quantity: restore,
      note: shortfall.isZero()
        ? note
        : `${note}. ${Number(shortfall)} ${container!.unit} could not be restored: the container has been refilled since.`,
    });
    if (result.duplicate) duplicates += 1;
    else reversed += 1;
  }

  return {
    deductions: deductions.length,
    reversed,
    duplicates,
    skipped,
  };
};
