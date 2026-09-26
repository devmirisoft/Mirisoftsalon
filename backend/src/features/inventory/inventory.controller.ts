import { type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import {
  branchScope,
  getSalonId,
  sendInventoryError,
  transactionError,
} from "../products/inventory-access.js";
import { branchFilterFor, pinnedBranchId } from "../../utils/branch-scope.js";
import {
  getSalonLocalParts,
  getSalonMonthRange,
  salonLocalDateTimeToUtc,
} from "../../utils/timezone.js";
import {
  INVENTORY_LOCATIONS,
  locationStock,
  siteKeyOf,
  transferStock,
} from "../stock/stockMovement.service.js";
import {
  isContainerTracked,
  openContainers,
  RECONCILE_REASONS,
  reconcileContainer,
  type ReconcileReason,
} from "../stock/productContainer.service.js";
import { buildUsagePlan } from "../stock/serviceUsage.service.js";

const param = (req: Request, name: string) => {
  const value = req.params[name];
  return typeof value === "string" ? value : "";
};

const salonWhere = (req: Request) =>
  req.user?.role === "SUPER_ADMIN"
    ? typeof req.query.salonId === "string"
      ? { salonId: req.query.salonId }
      : {}
    : { salonId: req.user?.salonId || "__missing__" };

/** A product the caller may see: own salon, own branch or salon-wide. */
const findProduct = (req: Request, productId: string) =>
  prisma.product.findFirst({
    where: { id: productId, ...salonWhere(req), ...branchScope(req) },
  });

/**
 * Stock sites the caller may read and act on: a pinned caller its own branch
 * plus the salon-level stock that branch draws from, everyone else all.
 */
const visibleSiteKeys = (req: Request) => {
  const pinned = pinnedBranchId(req.user);
  return pinned ? [siteKeyOf(pinned), siteKeyOf(null)] : null;
};

const requestId = z.string().trim().min(8).max(64).optional();
const quantity = z.coerce.number().positive().max(99_999_999);
const sendValidation = (res: Response, error: z.ZodError) =>
  res.status(400).json({
    success: false,
    message: error.issues[0]?.message ?? "Invalid request",
  });

const periodStarts = (timezone: string) => {
  const local = getSalonLocalParts(new Date(), timezone);
  const daysAgo = (days: number) =>
    salonLocalDateTimeToUtc(
      new Date(Date.UTC(local.year, local.month - 1, local.day - days))
        .toISOString()
        .slice(0, 10),
      "00:00",
      timezone
    );
  const sinceMonday = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ].indexOf(local.weekday);
  return {
    today: daysAgo(0),
    week: daysAgo(Math.max(sinceMonday, 0)),
    month: getSalonMonthRange(local.year, local.month, timezone).start,
  };
};

/**
 * Stock by location, opened containers, service usage and discrepancies for
 * one product. Quantities of a product opened into containers are reported
 * in the container unit (a sealed pack counts as its pack size); all sums are
 * done by the database in exact decimals.
 */
export const getProductInventory = async (req: Request, res: Response) => {
  try {
    const product = await findProduct(req, param(req, "productId"));
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    const sites = visibleSiteKeys(req);
    const tracked = isContainerTracked(product);
    // Figures are reported in the unit the product is used in, and only rows
    // recorded in that unit are summed: a quantity recorded in packs is never
    // silently reread as millilitres because a pack size was set later.
    const usageUnit = tracked ? product.packUnit! : product.unit;
    const salon = await prisma.salon.findUnique({
      where: { id: product.salonId },
      select: { timezone: true },
    });
    const periods = periodStarts(salon?.timezone || "Asia/Kolkata");
    const movementSites = sites
      ? Prisma.sql`AND COALESCE(m."branchId", 'SALON') IN (${Prisma.join(sites)})`
      : Prisma.empty;
    const inUsageUnit = Prisma.sql`COALESCE(m."unit"::text, ${product.unit}) = ${usageUnit}`;
    const amount = Prisma.sql`m."quantity"`;
    const usedRows = Prisma.sql`
      FROM "ProductStockMovement" m
      WHERE m."productId" = ${product.id}
        AND m."type" = 'USED_IN_SERVICE'
        AND ${inUsageUnit}
        ${movementSites}
        AND NOT EXISTS (
          SELECT 1 FROM "ProductStockMovement" r
          WHERE r."productId" = m."productId"
            AND r."type" = 'RETURNED'
            AND r."referenceType" = 'APPOINTMENT_CONSUMABLE_REVERSAL'
            AND r."referenceId" = m."referenceId"
        )`;

    const pinned = pinnedBranchId(req.user);
    const [stock, branches, staff, containers, [usage], byService, discrepancies, otherUnits] =
      await Promise.all([
        locationStock(prisma, [product]),
        prisma.branch.findMany({
          where: { salonId: product.salonId },
          select: { id: true, name: true },
        }),
        prisma.staff.findMany({
          where: {
            salonId: product.salonId,
            status: true,
            ...(pinned ? { OR: [{ branchId: pinned }, { branchId: null }] } : {}),
          },
          select: { id: true, name: true, branchId: true },
          orderBy: { name: "asc" },
        }),
        prisma.productContainer.findMany({
          where: {
            productId: product.id,
            ...(sites
              ? {
                  OR: [{ branchId: pinned! }, { branchId: null }],
                }
              : {}),
          },
          include: {
            openedByStaff: { select: { id: true, name: true } },
            openedBy: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
          },
          orderBy: [{ openedAt: "desc" }],
          take: 200,
        }),
        prisma.$queryRaw<
          Array<{
            today: Prisma.Decimal;
            week: Prisma.Decimal;
            month: Prisma.Decimal;
            total: Prisma.Decimal;
          }>
        >`
          SELECT
            COALESCE(SUM(${amount}) FILTER (WHERE m."createdAt" >= ${periods.today}), 0) AS "today",
            COALESCE(SUM(${amount}) FILTER (WHERE m."createdAt" >= ${periods.week}), 0) AS "week",
            COALESCE(SUM(${amount}) FILTER (WHERE m."createdAt" >= ${periods.month}), 0) AS "month",
            COALESCE(SUM(${amount}), 0) AS "total"
          ${usedRows}`,
        prisma.$queryRaw<
          Array<{
            serviceId: string | null;
            serviceName: string | null;
            used: Prisma.Decimal;
            lines: number;
            averageExpected: Prisma.Decimal | null;
            averageActual: Prisma.Decimal;
          }>
        >`
          WITH per_line AS (
            SELECT
              m."serviceId",
              COALESCE(m."appointmentServiceId", m."id") AS "line",
              SUM(${amount}) AS "used",
              -- One expected quantity per service line, however many
              -- containers supplied it.
              MAX(m."expectedQuantity") AS "expected"
            ${usedRows}
            GROUP BY 1, 2
          )
          SELECT
            p."serviceId",
            s."name" AS "serviceName",
            SUM(p."used") AS "used",
            COUNT(*)::int AS "lines",
            ROUND(AVG(p."expected"), 2) AS "averageExpected",
            ROUND(AVG(p."used"), 2) AS "averageActual"
          FROM per_line p
          LEFT JOIN "Service" s ON s."id" = p."serviceId"
          GROUP BY 1, 2
          ORDER BY 3 DESC`,
        prisma.$queryRaw<
          Array<{ type: string; quantity: Prisma.Decimal; reconciled: Prisma.Decimal }>
        >`
          SELECT
            m."type"::text AS "type",
            COALESCE(SUM(${amount}), 0) AS "quantity",
            -- Variance a physical count found, signed: what the count said
            -- minus what the system held. Adjustments already carry a sign;
            -- wastage, loss and damage are quantities taken away.
            COALESCE(SUM(CASE WHEN m."type" = 'ADJUSTMENT' THEN m."quantity" ELSE -m."quantity" END)
              FILTER (WHERE m."referenceType" = 'RECONCILE'), 0) AS "reconciled"
          FROM "ProductStockMovement" m
          WHERE m."productId" = ${product.id}
            AND m."type" IN ('WASTAGE', 'LOST', 'DAMAGED', 'ADJUSTMENT')
            AND ${inUsageUnit}
            ${movementSites}
          GROUP BY 1`,
        // Use, wastage and loss recorded in another unit: whole packs of a
        // product measured in millilitres, or rows from before this product
        // had a pack size. Kept apart instead of converted on a guess.
        prisma.$queryRaw<
          Array<{ unit: string; type: string; quantity: Prisma.Decimal }>
        >`
          SELECT
            COALESCE(m."unit"::text, ${product.unit}) AS "unit",
            m."type"::text AS "type",
            SUM(m."quantity") AS "quantity"
          FROM "ProductStockMovement" m
          WHERE m."productId" = ${product.id}
            AND m."type" IN ('USED_IN_SERVICE', 'WASTAGE', 'LOST', 'DAMAGED', 'ADJUSTMENT')
            AND NOT (${inUsageUnit})
            ${movementSites}
          GROUP BY 1, 2
          ORDER BY 1, 2`,
      ]);

    const branchName = new Map(branches.map((branch) => [branch.id, branch.name]));
    const siteRows = stock.rows(product.id);
    const siteIds = [
      ...new Set([
        ...siteRows.map((row) => row.branchId),
        ...containers
          .filter((container) => container.status === "OPEN")
          .map((container) => container.branchId),
      ]),
    ].filter((branchId) => !sites || sites.includes(siteKeyOf(branchId)));
    // Always show where the caller works, even before stock arrives there.
    const home = pinned ?? product.branchId;
    if (
      pinned
        ? !siteIds.some((branchId) => branchId === pinned)
        : siteIds.length === 0
    ) {
      siteIds.unshift(home);
    }
    const discrepancy = (type: string) =>
      discrepancies.find((row) => row.type === type)?.quantity ??
      new Prisma.Decimal(0);

    return res.json({
      success: true,
      data: {
        product: {
          id: product.id,
          name: product.name,
          unit: product.unit,
          packSize: product.packSize,
          packUnit: product.packUnit,
          containerTracked: tracked,
          currentStock: product.currentStock,
          /** Unit of usage and discrepancy figures. */
          usageUnit: tracked ? product.packUnit : product.unit,
        },
        sites: siteIds.map((branchId) => {
          const open = containers.filter(
            (container) =>
              container.status === "OPEN" &&
              siteKeyOf(container.branchId) === siteKeyOf(branchId)
          );
          const service = stock.at(product.id, branchId, "SERVICE");
          return {
            branchId,
            branchName: branchId ? (branchName.get(branchId) ?? "Branch") : "Salon level",
            ...Object.fromEntries(
              INVENTORY_LOCATIONS.map((location) => [
                location,
                stock.at(product.id, branchId, location),
              ])
            ),
            // An open pack is still in SERVICE; what is left sealed is what
            // can be moved, sold or opened.
            sealedService: service.minus(open.length),
            openContainers: open.length,
            openRemaining: open.reduce(
              (sum, container) => sum.plus(container.remainingQuantity),
              new Prisma.Decimal(0)
            ),
          };
        }),
        branches: branches.filter(
          (branch) => !sites || sites.includes(siteKeyOf(branch.id))
        ),
        staff,
        containers,
        usage,
        usageByService: byService.map((row) => ({
          ...row,
          serviceName: row.serviceName ?? "Other",
        })),
        discrepancies: {
          serviceUsage: usage?.total ?? new Prisma.Decimal(0),
          wastage: discrepancy("WASTAGE"),
          lost: discrepancy("LOST"),
          damaged: discrepancy("DAMAGED"),
          adjustments: discrepancy("ADJUSTMENT"),
          /** Of the figures above, what a physical count found. */
          foundOnReconciliation: discrepancies.reduce(
            (sum, row) => sum.plus(row.reconciled),
            new Prisma.Decimal(0)
          ),
        },
        /**
         * Use and write-offs recorded in another unit, e.g. whole packs of a
         * product measured in millilitres, or rows from before this product
         * had a pack size. Never folded into the figures above.
         */
        movementsInOtherUnits: otherUnits,
      },
    });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

const transferSchema = z.object({
  productId: z.string().uuid(),
  quantity,
  fromLocation: z.enum(INVENTORY_LOCATIONS),
  toLocation: z.enum(INVENTORY_LOCATIONS),
  /** Receiving branch; pinned callers always receive into their own. */
  branchId: z.string().uuid().nullable().optional(),
  /** Take the stock from salon-level stock instead of the same branch. */
  fromSalonStock: z.boolean().optional(),
  issuedByStaffId: z.string().uuid().optional(),
  receivedByStaffId: z.string().uuid().optional(),
  note: z.string().trim().max(500).optional(),
  requestId,
});

export const postTransfer = async (req: Request, res: Response) => {
  const parsed = transferSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendValidation(res, parsed.error);
  const body = parsed.data;
  try {
    // Service staff restock their own area; the shelves are the counter's.
    if (req.user?.role === "STAFF" && body.toLocation !== "SERVICE") {
      return res.status(403).json({
        success: false,
        message: "Staff can only transfer stock into the service area",
      });
    }
    const product = await findProduct(req, body.productId);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    const pinned = pinnedBranchId(req.user);
    const toBranchId =
      pinned ?? (body.branchId === undefined ? product.branchId : body.branchId);
    const data = await prisma.$transaction((tx) =>
      transferStock({
        tx,
        salonId: product.salonId,
        productId: product.id,
        quantity: body.quantity,
        fromBranchId: body.fromSalonStock ? null : toBranchId,
        fromLocation: body.fromLocation,
        toBranchId,
        toLocation: body.toLocation,
        ...(body.issuedByStaffId ? { issuedByStaffId: body.issuedByStaffId } : {}),
        ...(body.receivedByStaffId ? { receivedByStaffId: body.receivedByStaffId } : {}),
        ...(body.note ? { note: body.note } : {}),
        ...(body.requestId ? { requestId: body.requestId } : {}),
        ...(req.user?.userId ? { createdById: req.user.userId } : {}),
      })
    );
    return res.status(data.duplicate ? 200 : 201).json({
      success: true,
      data: { movement: data.movement, duplicate: data.duplicate },
    });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

const openSchema = z.object({
  productId: z.string().uuid(),
  count: z.coerce.number().int().min(1).max(50).optional(),
  branchId: z.string().uuid().nullable().optional(),
  openedByStaffId: z.string().uuid().optional(),
  reason: z.string().trim().max(200).optional(),
  requestId,
});

export const postOpenContainers = async (req: Request, res: Response) => {
  const parsed = openSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendValidation(res, parsed.error);
  const body = parsed.data;
  try {
    const product = await findProduct(req, body.productId);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    const pinned = pinnedBranchId(req.user);
    const data = await prisma.$transaction((tx) =>
      openContainers({
        tx,
        salonId: product.salonId,
        productId: product.id,
        branchId:
          pinned ?? (body.branchId === undefined ? product.branchId : body.branchId),
        ...(body.count ? { count: body.count } : {}),
        ...(body.openedByStaffId ? { openedByStaffId: body.openedByStaffId } : {}),
        ...(body.reason ? { reason: body.reason } : {}),
        ...(body.requestId ? { requestId: body.requestId } : {}),
        ...(req.user?.userId ? { createdById: req.user.userId } : {}),
      })
    );
    return res.status(data.duplicate ? 200 : 201).json({
      success: true,
      data: { containers: data.containers, duplicate: data.duplicate },
    });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

const reconcileSchema = z.object({
  actualRemaining: z.coerce.number().min(0).max(99_999_999),
  reason: z.enum(
    Object.keys(RECONCILE_REASONS) as [ReconcileReason, ...ReconcileReason[]]
  ),
  note: z.string().trim().max(500).optional(),
  requestId,
});

export const postReconcileContainer = async (req: Request, res: Response) => {
  const parsed = reconcileSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendValidation(res, parsed.error);
  const body = parsed.data;
  try {
    const container = await prisma.productContainer.findFirst({
      where: { id: param(req, "containerId"), ...salonWhere(req) },
      select: { id: true, salonId: true, branchId: true },
    });
    const sites = visibleSiteKeys(req);
    const pinned = pinnedBranchId(req.user);
    // A pinned caller reconciles only containers of its own branch.
    if (!container || (sites && container.branchId !== pinned)) {
      return res.status(404).json({ success: false, message: "Container not found" });
    }
    const data = await prisma.$transaction((tx) =>
      reconcileContainer({
        tx,
        salonId: container.salonId,
        containerId: container.id,
        actualRemaining: body.actualRemaining,
        reason: body.reason,
        ...(body.note ? { note: body.note } : {}),
        ...(body.requestId ? { requestId: body.requestId } : {}),
        ...(req.user?.userId ? { createdById: req.user.userId } : {}),
      })
    );
    return res.status(data.duplicate ? 200 : 201).json({
      success: true,
      data: {
        container: data.container,
        movement: data.movement,
        duplicate: data.duplicate,
      },
    });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

export const getUsagePlan = async (req: Request, res: Response) => {
  try {
    const salonId = getSalonId(req, req.query.salonId);
    const branchId = branchFilterFor(req);
    const appointment = await prisma.appointment.findFirst({
      where: {
        id: param(req, "appointmentId"),
        ...(req.user?.role === "SUPER_ADMIN"
          ? salonId
            ? { salonId }
            : {}
          : { salonId: salonId || "__missing__" }),
        ...(branchId ? { branchId } : {}),
      },
      select: { id: true, salonId: true, branchId: true },
    });
    if (!appointment) {
      throw transactionError("Appointment not found", 404);
    }
    const data = await buildUsagePlan(prisma, appointment);
    return res.json({ success: true, data });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};
