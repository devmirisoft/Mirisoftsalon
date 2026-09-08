import { type Request, type Response } from "express";
import { prisma } from "../../config/prisma.js";
import {
  getSalonId,
  sendInventoryError,
  transactionError,
  validateBranch,
} from "../products/inventory-access.js";
import { parseSalonDateRange } from "../../utils/timezone.js";

const num = (value: unknown) => Number(value ?? 0);

/** Sums amounts and counts into a keyed bucket, then hands back ranked rows. */
export const ranker = () => {
  const rows = new Map<string, { label: string; value: number; count: number }>();
  return {
    add(key: string | null | undefined, label: string, value = 0, count = 1) {
      if (!key) return;
      const row = rows.get(key) ?? { label, value: 0, count: 0 };
      row.value += value;
      row.count += count;
      rows.set(key, row);
    },
    all() {
      return Array.from(rows.values());
    },
    top(limit: number) {
      return Array.from(rows.values())
        .sort((a, b) => b.value - a.value || b.count - a.count)
        .slice(0, limit);
    },
    topByCount(limit: number) {
      return Array.from(rows.values())
        .sort((a, b) => b.count - a.count || b.value - a.value)
        .slice(0, limit);
    },
  };
};

const rankRows = (rows: { label: string; value: number; count: number }[]) =>
  rows.map((row) => ({ name: row.label, amount: row.value, count: row.count }));

const methodRows = (rows: { label: string; value: number; count: number }[]) =>
  rows.map((row) => ({ method: row.label, amount: row.value, count: row.count }));

const resolveScope = async (req: Request) => {
  let salonId = getSalonId(req, req.query.salonId);
  const restrictedBranch =
    (req.user?.role === "BRANCH_MANAGER" || req.user?.role === "RECEPTIONIST") &&
    req.user.branchId
      ? req.user.branchId
      : undefined;
  const branchId =
    restrictedBranch ??
    (typeof req.query.branchId === "string" ? req.query.branchId : undefined);
  if (req.user?.role !== "SUPER_ADMIN" && !salonId) {
    throw transactionError("Salon is required");
  }
  if (branchId && !salonId && req.user?.role === "SUPER_ADMIN") {
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { salonId: true },
    });
    if (!branch) throw transactionError("Branch not found", 404);
    salonId = branch.salonId;
  }
  if (salonId && !(await validateBranch(salonId, branchId))) {
    throw transactionError("Invalid branch for this salon");
  }
  return { salonId, branchId };
};

export const localDay = (date: Date, timezone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

/**
 * Turn a period preset into local YYYY-MM-DD bounds. `custom` (or any
 * unknown value) passes the supplied from/to straight through.
 */
export const periodBounds = (
  period: string,
  timezone: string,
  from: string | undefined,
  to: string | undefined,
  now: Date
) => {
  const today = localDay(now, timezone);
  const daysBack = (days: number) => {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
  };
  if (period === "day") return { start: today, end: today };
  if (period === "week") return { start: daysBack(6), end: today };
  if (period === "month") return { start: daysBack(29), end: today };
  return { start: from, end: to };
};

/**
 * Resolve the reporting window. `period` is day | week | month | custom;
 * custom uses the supplied from/to. Everything is anchored to the salon
 * timezone so "today" means the salon own day, not the server day.
 */
const resolveRange = async (req: Request, salonId?: string) => {
  const salon = salonId
    ? await prisma.salon.findUnique({
        where: { id: salonId },
        select: { timezone: true },
      })
    : null;
  const timezone = salon?.timezone ?? "Asia/Kolkata";
  const period =
    typeof req.query.period === "string" ? req.query.period : "month";
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;

  const { start, end } = periodBounds(period, timezone, from, to, new Date());
  if (!start && !end) {
    return { range: undefined, timezone, start: null, end: null };
  }
  try {
    const parsed = parseSalonDateRange(start, end, timezone);
    return {
      range: {
        ...(parsed.start ? { gte: parsed.start } : {}),
        ...(parsed.end ? { lt: parsed.end } : {}),
      },
      timezone,
      start: parsed.start ?? null,
      end: parsed.end ?? null,
    };
  } catch {
    throw transactionError("Invalid date range");
  }
};

type DateRange = { gte?: Date; lt?: Date } | undefined;

/**
 * The platform view: a SUPER_ADMIN with no salon selected gets totals summed
 * across every salon, which says nothing about which salon earned what. This
 * breaks the same money streams out per salon so they can be compared.
 */
const perSalonTotals = async (range: DateRange) => {
  const bySalon = (
    rows: {
      salonId: string | null;
      _sum: { amount?: unknown; totalAmount?: unknown };
    }[]
  ) =>
    new Map(
      rows.map((row) => [
        row.salonId,
        num(row._sum.amount ?? row._sum.totalAmount),
      ])
    );

  const [salons, payments, sales, retailSales, purchases, expenses] =
    await Promise.all([
      prisma.salon.findMany({ select: { id: true, name: true } }),
      prisma.payment.groupBy({
        by: ["salonId"],
        where: { ...(range ? { paidAt: range } : {}) },
        _sum: { amount: true },
      }),
      prisma.sale.groupBy({
        by: ["salonId"],
        where: { status: "ACTIVE", ...(range ? { saleDate: range } : {}) },
        _sum: { totalAmount: true },
      }),
      prisma.retailSale.groupBy({
        by: ["salonId"],
        where: { ...(range ? { saleDate: range } : {}) },
        _sum: { totalAmount: true },
      }),
      prisma.productPurchase.groupBy({
        by: ["salonId"],
        where: { ...(range ? { purchaseDate: range } : {}) },
        _sum: { totalAmount: true },
      }),
      prisma.expense.groupBy({
        by: ["salonId"],
        where: { ...(range ? { expenseDate: range } : {}) },
        _sum: { amount: true },
      }),
    ]);

  const paymentTotals = bySalon(payments);
  const saleTotals = bySalon(sales);
  const retailTotals = bySalon(retailSales);
  const purchaseTotals = bySalon(purchases);
  const expenseTotals = bySalon(expenses);

  return salons
    .map((salon) => {
      const servicePayments = paymentTotals.get(salon.id) ?? 0;
      const saleRevenue = saleTotals.get(salon.id) ?? 0;
      const retailSalesTotal = retailTotals.get(salon.id) ?? 0;
      const productPurchaseCost = purchaseTotals.get(salon.id) ?? 0;
      const expensesTotal = expenseTotals.get(salon.id) ?? 0;

      return {
        salonId: salon.id,
        name: salon.name,
        servicePayments,
        saleRevenue,
        retailSalesTotal,
        productPurchaseCost,
        expensesTotal,
        // Same formula as the headline netEarnings, per salon.
        netEarnings:
          servicePayments +
          saleRevenue +
          retailSalesTotal -
          productPurchaseCost -
          expensesTotal,
      };
    })
    .sort((a, b) => b.netEarnings - a.netEarnings);
};

export const getSalonReport = async (req: Request, res: Response) => {
  try {
    const { salonId, branchId } = await resolveScope(req);
    const { range, timezone, start, end } = await resolveRange(req, salonId);
    const customerType =
      typeof req.query.customerType === "string"
        ? req.query.customerType
        : "all";
    const common = {
      ...(salonId ? { salonId } : {}),
      ...(branchId ? { branchId } : {}),
    };

    // Only the all-salons view needs the breakdown; a selected salon is already
    // the whole report.
    const salonBreakdown = salonId ? null : await perSalonTotals(range);

    const [
      payments,
      salePayments,
      sales,
      retailSales,
      purchases,
      expenses,
      appointments,
      invoiceItems,
      retailItems,
      memberships,
      newCustomers,
    ] = await Promise.all([
      // Invoice payments: the service/billing side of the till.
      prisma.payment.findMany({
        where: { ...common, ...(range ? { paidAt: range } : {}) },
        select: { amount: true, method: true, paidAt: true },
      }),
      // Payments recorded against quick sales.
      prisma.salePayment.findMany({
        where: {
          ...(range ? { paidAt: range } : {}),
          sale: { is: { ...common, status: "ACTIVE" } },
        },
        select: { amount: true, method: true, paidAt: true },
      }),
      prisma.sale.findMany({
        where: {
          ...common,
          status: "ACTIVE",
          ...(range ? { saleDate: range } : {}),
        },
        select: { totalAmount: true, saleDate: true },
      }),
      prisma.retailSale.findMany({
        where: { ...common, ...(range ? { saleDate: range } : {}) },
        select: { totalAmount: true, saleDate: true, paymentMethod: true },
      }),
      prisma.productPurchase.aggregate({
        where: { ...common, ...(range ? { purchaseDate: range } : {}) },
        _sum: { totalAmount: true },
      }),
      prisma.expense.findMany({
        where: { ...common, ...(range ? { expenseDate: range } : {}) },
        select: { amount: true, category: true, expenseDate: true },
      }),
      prisma.appointment.findMany({
        where: {
          ...common,
          ...(range ? { startTime: range } : {}),
          ...(customerType === "appointment" ? { walkInJobCart: false } : {}),
          ...(customerType === "jobcard" ? { walkInJobCart: true } : {}),
        },
        select: {
          status: true,
          walkInJobCart: true,
          startTime: true,
          customerId: true,
          customer: { select: { createdAt: true } },
        },
      }),
      // Issued invoice lines: the source for service, category and staff ranks.
      prisma.invoiceItem.findMany({
        where: {
          invoice: {
            is: {
              ...common,
              status: "ISSUED",
              ...(range ? { invoiceDate: range } : {}),
            },
          },
        },
        select: {
          itemType: true,
          lineTotal: true,
          quantity: true,
          serviceName: true,
          serviceId: true,
          productId: true,
          soldByStaffId: true,
          soldByStaff: { select: { name: true } },
          service: {
            select: {
              name: true,
              mainService: { select: { id: true, name: true } },
            },
          },
          product: { select: { name: true } },
          invoice: {
            select: {
              appointment: {
                select: { staffId: true, staff: { select: { name: true } } },
              },
            },
          },
        },
      }),
      prisma.retailSaleItem.findMany({
        where: {
          sale: { is: { ...common, ...(range ? { saleDate: range } : {}) } },
        },
        select: {
          quantity: true,
          totalPrice: true,
          productId: true,
          product: { select: { name: true } },
          sale: {
            select: {
              paymentMethod: true,
              staffId: true,
              staff: { select: { name: true } },
            },
          },
        },
      }),
      prisma.customerMembership.findMany({
        where: { ...common, ...(range ? { startsAt: range } : {}) },
        select: {
          membershipId: true,
          membershipNameSnapshot: true,
          amountPaid: true,
          paymentMethod: true,
          durationMonthsSnapshot: true,
          status: true,
        },
      }),
      prisma.customer.findMany({
        where: { ...common, ...(range ? { createdAt: range } : {}) },
        select: { createdAt: true },
      }),
    ]);

    // ---- Money in and out ------------------------------------------------
    const servicePayments = payments.reduce(
      (sum, row) => sum + num(row.amount),
      0
    );
    const saleRevenue = sales.reduce((sum, row) => sum + num(row.totalAmount), 0);
    const retailSalesTotal = retailSales.reduce(
      (sum, row) => sum + num(row.totalAmount),
      0
    );
    const productPurchaseCost = num(purchases._sum.totalAmount);
    const expensesTotal = expenses.reduce((sum, row) => sum + num(row.amount), 0);
    const productSalesTotal =
      invoiceItems
        .filter((row) => row.itemType === "PRODUCT")
        .reduce((sum, row) => sum + num(row.lineTotal), 0) + retailSalesTotal;
    // Membership lines are reported under memberships below, so leaving them
    // out here keeps the two figures from double counting the same money.
    const serviceSalesTotal = invoiceItems
      .filter(
        (row) => row.itemType !== "PRODUCT" && row.itemType !== "MEMBERSHIP"
      )
      .reduce((sum, row) => sum + num(row.lineTotal), 0);
    const netEarnings =
      servicePayments +
      saleRevenue +
      retailSalesTotal -
      productPurchaseCost -
      expensesTotal;

    // ---- Payment method mix ----------------------------------------------
    // Each till entry counts once: invoice payments, sale payments, and
    // retail sales (which carry their method on the sale itself).
    const methods = ranker();
    for (const row of payments) {
      methods.add(row.method, row.method, num(row.amount));
    }
    for (const row of salePayments) {
      methods.add(row.method, row.method, num(row.amount));
    }
    for (const row of retailSales) {
      const method = row.paymentMethod ?? "OTHER";
      methods.add(method, method, num(row.totalAmount));
    }

    // ---- Daily trend ------------------------------------------------------
    const trend = new Map<
      string,
      {
        date: string;
        revenue: number;
        expenses: number;
        appointments: number;
        customers: number;
      }
    >();
    const bucket = (date: Date) => {
      const key = localDay(date, timezone);
      const row = trend.get(key) ?? {
        date: key,
        revenue: 0,
        expenses: 0,
        appointments: 0,
        customers: 0,
      };
      trend.set(key, row);
      return row;
    };
    for (const row of payments) bucket(row.paidAt).revenue += num(row.amount);
    for (const row of sales) bucket(row.saleDate).revenue += num(row.totalAmount);
    for (const row of retailSales) {
      bucket(row.saleDate).revenue += num(row.totalAmount);
    }
    for (const row of expenses) {
      bucket(row.expenseDate).expenses += num(row.amount);
    }
    for (const row of appointments) bucket(row.startTime).appointments += 1;
    for (const row of newCustomers) bucket(row.createdAt).customers += 1;

    // ---- Customers --------------------------------------------------------
    // A visit counts as new when the customer record was created in-window.
    const windowStart = start?.getTime() ?? 0;
    const windowEnd = end?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const isNew = (createdAt?: Date) =>
      Boolean(
        createdAt &&
          createdAt.getTime() >= windowStart &&
          createdAt.getTime() < windowEnd
      );
    const visitorIds = new Set(appointments.map((row) => row.customerId));
    const newVisitorIds = new Set(
      appointments
        .filter((row) => isNew(row.customer?.createdAt))
        .map((row) => row.customerId)
    );

    // ---- Rankings ---------------------------------------------------------
    const serviceRank = ranker();
    const categoryRank = ranker();
    const serviceStaffRank = ranker();
    const staffServicePairRank = ranker();
    const productRank = ranker();
    const productStaffRank = ranker();
    const productMethods = ranker();
    const membershipRank = ranker();
    const membershipDuration = ranker();
    const membershipMethods = ranker();
    const expenseCategories = ranker();

    for (const item of invoiceItems) {
      const total = num(item.lineTotal);
      const quantity = item.quantity ?? 1;
      if (item.itemType === "PRODUCT") {
        productRank.add(
          item.productId ?? item.serviceName,
          item.product?.name ?? item.serviceName,
          total,
          quantity
        );
        productStaffRank.add(
          item.soldByStaffId,
          item.soldByStaff?.name ?? "Unassigned",
          total,
          quantity
        );
        continue;
      }
      if (item.serviceId) {
        serviceRank.add(
          item.serviceId,
          item.service?.name ?? item.serviceName,
          total,
          quantity
        );
        const category = item.service?.mainService;
        categoryRank.add(
          category?.id,
          category?.name ?? "Uncategorised",
          total,
          quantity
        );
      }
      // Service delivery is credited to the appointment staff; a counter sale
      // falls back to whoever billed it.
      const staffId = item.invoice?.appointment?.staffId ?? item.soldByStaffId;
      const staffName =
        item.invoice?.appointment?.staff?.name ??
        item.soldByStaff?.name ??
        "Unassigned";
      serviceStaffRank.add(staffId, staffName, total, quantity);
      if (staffId && item.serviceId) {
        staffServicePairRank.add(
          `${staffId}:${item.serviceId}`,
          `${staffName} - ${item.service?.name ?? item.serviceName}`,
          total,
          quantity
        );
      }
    }

    for (const item of retailItems) {
      const total = num(item.totalPrice);
      const quantity = num(item.quantity);
      productRank.add(
        item.productId,
        item.product?.name ?? "Product",
        total,
        quantity
      );
      productStaffRank.add(
        item.sale?.staffId,
        item.sale?.staff?.name ?? "Unassigned",
        total,
        quantity
      );
      const method = item.sale?.paymentMethod ?? "OTHER";
      productMethods.add(method, method, total, quantity);
    }

    for (const row of memberships) {
      const paid = num(row.amountPaid);
      membershipRank.add(row.membershipId, row.membershipNameSnapshot, paid);
      membershipDuration.add(
        row.membershipId,
        row.membershipNameSnapshot,
        row.durationMonthsSnapshot ?? 0
      );
      const method = row.paymentMethod ?? "OTHER";
      membershipMethods.add(method, method, paid);
    }

    for (const row of expenses) {
      expenseCategories.add(row.category, row.category, num(row.amount));
    }

    // Longest-lasting plan = highest average validity across its sales.
    const longestMembership =
      membershipDuration
        .all()
        .map((row) => ({
          name: row.label,
          months: row.count ? row.value / row.count : 0,
        }))
        .sort((a, b) => b.months - a.months)[0] ?? null;

    return res.json({
      success: true,
      data: {
        range: {
          from: start ? localDay(start, timezone) : null,
          to: end ? localDay(new Date(end.getTime() - 1), timezone) : null,
          timezone,
          customerType,
        },
        ...(salonBreakdown ? { salonBreakdown } : {}),
        totals: {
          servicePayments,
          serviceSalesTotal,
          saleRevenue,
          productSalesTotal,
          retailSalesTotal,
          productPurchaseCost,
          expensesTotal,
          netEarnings,
        },
        paymentMethods: methodRows(methods.top(20)),
        trend: Array.from(trend.values()).sort((a, b) =>
          a.date.localeCompare(b.date)
        ),
        customers: {
          newCustomers: newCustomers.length,
          visitingCustomers: visitorIds.size,
          newVisitingCustomers: newVisitorIds.size,
          appointments: appointments.filter((row) => !row.walkInJobCart).length,
          jobCards: appointments.filter((row) => row.walkInJobCart).length,
          completed: appointments.filter((row) => row.status === "COMPLETED")
            .length,
          cancelled: appointments.filter((row) => row.status === "CANCELLED")
            .length,
          noShow: appointments.filter((row) => row.status === "NO_SHOW").length,
        },
        memberships: {
          sold: memberships.length,
          revenue: memberships.reduce((sum, row) => sum + num(row.amountPaid), 0),
          active: memberships.filter((row) => row.status === "ACTIVE").length,
          topSelling: rankRows(membershipRank.topByCount(10)),
          longestDuration: longestMembership,
          paymentMethods: methodRows(membershipMethods.top(10)),
        },
        rankings: {
          topServices: rankRows(serviceRank.top(10)),
          topServiceCategories: rankRows(categoryRank.top(10)),
          topServiceStaff: rankRows(serviceStaffRank.top(10)),
          topStaffServicePairs: rankRows(staffServicePairRank.top(10)),
          topProducts: rankRows(productRank.top(5)),
          topProductStaff: rankRows(productStaffRank.top(10)),
          productPaymentMethods: methodRows(productMethods.top(10)),
          expenseCategories: rankRows(expenseCategories.top(10)),
        },
      },
    });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};
