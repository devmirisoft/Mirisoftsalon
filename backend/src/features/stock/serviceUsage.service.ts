import { z } from "zod";
import { Prisma } from "../../generated/prisma/client.js";
import { transactionError } from "../products/inventory-access.js";
import {
  createStockMovement,
  exactQuantity,
  locationStock,
  siteKeyOf,
} from "./stockMovement.service.js";
import {
  consumeFromOpenContainers,
  isContainerTracked,
  moveContainerContent,
} from "./productContainer.service.js";

type TransactionClient = Prisma.TransactionClient;
type ReadClient = Pick<
  TransactionClient,
  | "appointmentService"
  | "serviceConsumable"
  | "product"
  | "productStockMovement"
  | "productLocationStock"
  | "productContainer"
  | "staff"
>;

/** One actual quantity for one consumable of one service line. */
export type ServiceUsageEntry = {
  appointmentServiceId: string;
  productId: string;
  quantity: number | string;
  /** Opened container it came from; left out, the oldest open ones are used. */
  containerId?: string | undefined;
};

/** Request body shape of `usage` on appointment completion and job cart confirm. */
export const serviceUsageSchema = z
  .array(
    z.object({
      appointmentServiceId: z.string().uuid(),
      productId: z.string().uuid(),
      quantity: z.coerce.number().min(0).max(99_999_999),
      containerId: z.string().uuid().optional(),
    })
  )
  .max(500);

const productSelect = {
  id: true,
  name: true,
  unit: true,
  packSize: true,
  packUnit: true,
  branchId: true,
  currentStock: true,
  isRetailProduct: true,
  isServiceConsumable: true,
} as const;

/**
 * The service lines of an appointment, and each line paired with what its
 * service is set up to use.
 */
const expectedUsage = async (
  client: ReadClient,
  appointmentId: string,
  salonId: string
) => {
  const lines = await client.appointmentService.findMany({
    where: { appointmentId },
    select: {
      id: true,
      serviceId: true,
      serviceName: true,
      staffId: true,
      staff: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const consumables = lines.length
    ? await client.serviceConsumable.findMany({
        where: {
          salonId,
          serviceId: { in: [...new Set(lines.map((line) => line.serviceId))] },
          status: true,
        },
        select: {
          serviceId: true,
          quantity: true,
          product: { select: productSelect },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const expected = lines.flatMap((line) =>
    consumables
      .filter((consumable) => consumable.serviceId === line.serviceId)
      .map((consumable) => ({
        line,
        product: consumable.product,
        expected: consumable.quantity as Prisma.Decimal | null,
      }))
  );
  return { lines, expected };
};

/** Active service products a usage at this branch can be drawn from. */
const serviceProductsWhere = (salonId: string, branchId: string | null) => ({
  salonId,
  status: true,
  isServiceConsumable: true,
  ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
});

/**
 * Books what the services of a completed appointment used. Every line gets its
 * own movement, linked to the service line, the service, the staff who did it
 * and the container it came from. Set-up consumables the caller does not
 * mention use the service defaults; any other service product the caller
 * names on a line is booked as given.
 */
export const recordServiceUsage = async (input: {
  tx: TransactionClient;
  appointment: {
    id: string;
    salonId: string;
    branchId: string | null;
    staffId: string | null;
  };
  usage?: ServiceUsageEntry[] | undefined;
  createdById?: string | undefined;
}) => {
  const { tx, appointment } = input;
  const { lines, expected } = await expectedUsage(
    tx,
    appointment.id,
    appointment.salonId
  );
  const usage = input.usage ?? [];
  const extraEntries = usage.filter(
    (entry) =>
      !expected.some(
        (item) =>
          item.line.id === entry.appointmentServiceId &&
          item.product.id === entry.productId
      )
  );
  const extraProducts = extraEntries.length
    ? await tx.product.findMany({
        where: {
          id: { in: [...new Set(extraEntries.map((entry) => entry.productId))] },
          ...serviceProductsWhere(appointment.salonId, appointment.branchId),
        },
        select: productSelect,
      })
    : [];
  const extras = new Map<string, (typeof expected)[number]>();
  for (const entry of extraEntries) {
    const line = lines.find((row) => row.id === entry.appointmentServiceId);
    const product = extraProducts.find((row) => row.id === entry.productId);
    if (!line || !product) {
      throw transactionError(
        "Usage can only be recorded for service products on the services of this appointment"
      );
    }
    extras.set(`${line.id}:${product.id}`, { line, product, expected: null });
  }

  const work = [...expected, ...extras.values()]
    .flatMap((item) => {
      const entries = usage.filter(
        (entry) =>
          entry.appointmentServiceId === item.line.id &&
          entry.productId === item.product.id
      );
      return entries.length
        ? entries.map((entry) => ({
            ...item,
            quantity: exactQuantity(entry.quantity),
            containerId: entry.containerId,
          }))
        : [{ ...item, quantity: item.expected ?? zero, containerId: undefined }];
    })
    // Product id order keeps the row-lock order stable between concurrent
    // completions.
    .sort((left, right) => left.product.id.localeCompare(right.product.id));

  for (const item of work) {
    if (item.quantity.isNegative()) {
      throw transactionError("Usage cannot be negative");
    }
    if (item.quantity.isZero()) continue;
    const branchId = appointment.branchId ?? item.product.branchId;
    const staffId = item.line.staffId ?? appointment.staffId;
    const links = {
      referenceType: "APPOINTMENT",
      referenceId: appointment.id,
      appointmentServiceId: item.line.id,
      serviceId: item.line.serviceId,
      ...(item.expected ? { expectedQuantity: item.expected } : {}),
      reason: "Used in completed appointment",
      ...(staffId ? { staffId } : {}),
      ...(input.createdById ? { createdById: input.createdById } : {}),
    };
    if (!isContainerTracked(item.product)) {
      if (item.containerId) {
        throw transactionError(
          `${item.product.name} is not opened into containers`
        );
      }
      await createStockMovement({
        tx,
        salonId: appointment.salonId,
        ...(appointment.branchId ? { branchId: appointment.branchId } : {}),
        productId: item.product.id,
        type: "USED_IN_SERVICE",
        quantity: item.quantity,
        ...links,
      });
    } else if (item.containerId) {
      await moveContainerContent({
        tx,
        salonId: appointment.salonId,
        containerId: item.containerId,
        productId: item.product.id,
        type: "USED_IN_SERVICE",
        quantity: item.quantity,
        branchId,
        ...links,
      });
    } else {
      await consumeFromOpenContainers({
        tx,
        salonId: appointment.salonId,
        product: item.product,
        branchId,
        quantity: item.quantity,
        ...links,
      });
    }
  }
};

const zero = new Prisma.Decimal(0);

/**
 * Everything the usage confirmation needs in one read: every service line with
 * the expected quantity per set-up consumable and the products used on that
 * service before, and for each service product the open containers and sealed
 * stock it could come from.
 */
export const buildUsagePlan = async (
  client: ReadClient,
  appointment: { id: string; salonId: string; branchId: string | null }
) => {
  const { lines: serviceLines, expected } = await expectedUsage(
    client,
    appointment.id,
    appointment.salonId
  );
  const catalog = serviceLines.length
    ? await client.product.findMany({
        where: serviceProductsWhere(appointment.salonId, appointment.branchId),
        select: productSelect,
        orderBy: { name: "asc" },
      })
    : [];
  const products = [
    ...new Map(
      [...expected.map((item) => item.product), ...catalog].map((product) => [
        product.id,
        product,
      ])
    ).values(),
  ];
  // Products booked on a service before are suggested on it, latest first.
  const history = serviceLines.length
    ? await client.productStockMovement.groupBy({
        by: ["serviceId", "productId"],
        where: {
          salonId: appointment.salonId,
          type: "USED_IN_SERVICE",
          serviceId: { in: [...new Set(serviceLines.map((line) => line.serviceId))] },
        },
        _max: { createdAt: true },
      })
    : [];
  history.sort(
    (left, right) =>
      (right._max.createdAt?.getTime() ?? 0) - (left._max.createdAt?.getTime() ?? 0)
  );
  const stock = await locationStock(client, products);
  const openPacks = products.length
    ? await client.productContainer.groupBy({
        by: ["productId", "branchId"],
        where: {
          productId: { in: products.map((product) => product.id) },
          location: "SERVICE",
          status: "OPEN",
        },
        _count: { _all: true },
      })
    : [];
  const containers = products.length
    ? await client.productContainer.findMany({
        where: {
          productId: { in: products.map((product) => product.id) },
          location: "SERVICE",
          status: "OPEN",
        },
        select: {
          id: true,
          code: true,
          productId: true,
          branchId: true,
          remainingQuantity: true,
          originalQuantity: true,
          unit: true,
          openedAt: true,
          openedByStaff: { select: { id: true, name: true } },
        },
        orderBy: [{ openedAt: "asc" }, { code: "asc" }],
      })
    : [];

  // Who can be named as having opened a pack or moved stock here.
  const staff = await client.staff.findMany({
    where: {
      salonId: appointment.salonId,
      status: true,
      ...(appointment.branchId
        ? { OR: [{ branchId: appointment.branchId }, { branchId: null }] }
        : {}),
    },
    select: { id: true, name: true, branchId: true },
    orderBy: { name: "asc" },
  });

  const lines = serviceLines.map((line) => ({
    appointmentServiceId: line.id,
    serviceId: line.serviceId,
    serviceName: line.serviceName,
    staff: line.staff,
    consumables: expected
      .filter((item) => item.line.id === line.id)
      .map((item) => ({ productId: item.product.id, expectedQuantity: item.expected })),
    suggestedProductIds: history
      .filter(
        (row) =>
          row.serviceId === line.serviceId &&
          catalog.some((product) => product.id === row.productId)
      )
      .map((row) => row.productId),
  }));

  return {
    appointmentId: appointment.id,
    branchId: appointment.branchId,
    staff,
    lines,
    products: products.map((product) => {
      const branchId = appointment.branchId ?? product.branchId;
      const tracked = isContainerTracked(product);
      return {
        id: product.id,
        name: product.name,
        stockUnit: product.unit,
        /** Unit of the consumable quantities. */
        unit: tracked ? product.packUnit : product.unit,
        packSize: product.packSize,
        containerTracked: tracked,
        branchId,
        stock: {
          WAREHOUSE: stock.at(product.id, branchId, "WAREHOUSE"),
          RETAIL: stock.at(product.id, branchId, "RETAIL"),
          SERVICE: stock.at(product.id, branchId, "SERVICE"),
        },
        // Packs standing open are part of SERVICE stock; only sealed ones can
        // be opened or moved.
        sealedService: stock
          .at(product.id, branchId, "SERVICE")
          .minus(
            openPacks.find(
              (row) =>
                row.productId === product.id &&
                siteKeyOf(row.branchId) === siteKeyOf(branchId)
            )?._count._all ?? 0
          ),
        /** Salon-level warehouse a branch can draw from. */
        salonWarehouse: branchId ? stock.at(product.id, null, "WAREHOUSE") : zero,
        openContainers: containers
          .filter(
            (container) =>
              container.productId === product.id &&
              siteKeyOf(container.branchId) === siteKeyOf(branchId)
          )
          .map(({ productId: _productId, branchId: _branchId, ...container }) => container),
      };
    }),
  };
};
