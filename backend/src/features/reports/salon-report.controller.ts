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

/**
 * Invoices carry no author columns, so created/edited by come from the audit
 * log: billing logs the invoice itself, a job cart logs the appointment behind
 * it. One query for the whole page, then `of(row)` reads the maps.
 */
const invoiceAuthors = async (
  invoices: { id: string; appointmentId?: string | null }[]
) => {
  const logs = await prisma.auditLog.findMany({
    where: {
      entityId: {
        in: invoices.flatMap((row) =>
          row.appointmentId ? [row.id, row.appointmentId] : [row.id]
        ),
      },
      OR: [
        { module: "INVOICE", action: { in: ["CREATE", "UPDATE"] } },
        { module: "JOB_CART", action: "CREATE" },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { entityId: true, action: true, userName: true },
  });
  const createdBy = new Map<string, string | null>();
  const editedBy = new Map<string, string | null>();
  for (const log of logs) {
    if (!log.entityId) continue;
    if (log.action === "UPDATE") editedBy.set(log.entityId, log.userName);
    else if (!createdBy.has(log.entityId)) createdBy.set(log.entityId, log.userName);
  }
  return {
    of: (row: { id: string; appointmentId?: string | null }) => ({
      createdBy:
        createdBy.get(row.id) ??
        (row.appointmentId ? createdBy.get(row.appointmentId) : null) ??
        null,
      editedBy: editedBy.get(row.id) ?? null,
    }),
  };
};

const PAYMENT_METHODS = [
  "CASH", "UPI", "GPAY", "PAYTM", "PHONEPE", "CARD",
  "BANK_TRANSFER", "CHEQUE", "MEMBERSHIP_WALLET", "OTHER",
] as const;

/**
 * Search filters shared by the EOD page and its export, so a download matches
 * what is on screen. Text is matched case-insensitively on a substring; an
 * unknown payment method is dropped rather than erroring the whole report.
 */
export const eodInvoiceFilters = (query: Request["query"]) => {
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;
  const name = text(query.name);
  const phone = text(query.phone);
  const invoiceNo = text(query.invoiceNo);
  const methods = String(query.methods ?? "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value): value is (typeof PAYMENT_METHODS)[number] =>
      PAYMENT_METHODS.includes(value as (typeof PAYMENT_METHODS)[number])
    );
  return {
    ...(name ? { customerName: { contains: name, mode: "insensitive" as const } } : {}),
    ...(phone ? { customerPhone: { contains: phone } } : {}),
    ...(invoiceNo
      ? { invoiceCode: { contains: invoiceNo, mode: "insensitive" as const } }
      : {}),
    ...(methods.length ? { payments: { some: { method: { in: methods } } } } : {}),
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
  // An explicit report filter beats the header's session branch; validateBranch
  // below still pins it to the caller's salon.
  const branchId =
    restrictedBranch ??
    (typeof req.query.branchId === "string" && req.query.branchId
      ? req.query.branchId
      : undefined) ??
    req.user?.activeBranchId;
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
  if (period === "quarter") return { start: daysBack(89), end: today };
  if (period === "halfyear") return { start: daysBack(181), end: today };
  if (period === "year") return { start: daysBack(364), end: today };
  return { start: from, end: to };
};

/**
 * Chart bucket for a local YYYY-MM-DD day: daily up to a month, weekly
 * (keyed by the Monday) up to half a year, monthly (YYYY-MM) beyond that.
 */
export const trendBucket = (day: string, spanDays: number) => {
  if (spanDays <= 31) return day;
  if (spanDays > 186) return day.slice(0, 7);
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
};

export const trendGranularity = (spanDays: number) =>
  spanDays <= 31 ? "day" : spanDays > 186 ? "month" : "week";

/**
 * Resolve the reporting window. `period` is day | week | month | custom;
 * custom uses the supplied from/to. Everything is anchored to the salon
 * timezone so "today" means the salon own day, not the server day.
 */
const resolveRange = async (
  req: Request,
  salonId?: string,
  defaultPeriod = "month"
) => {
  const salon = salonId
    ? await prisma.salon.findUnique({
        where: { id: salonId },
        select: { timezone: true },
      })
    : null;
  const timezone = salon?.timezone ?? "Asia/Kolkata";
  // A blank period is an absent one. Without this it falls through to the
  // custom branch with no from/to, which drops the date filter entirely and
  // scans every invoice ever billed.
  const period =
    typeof req.query.period === "string" && req.query.period.trim()
      ? req.query.period.trim()
      : defaultPeriod;
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
    const param = (key: string) =>
      typeof req.query[key] === "string" && req.query[key]
        ? (req.query[key] as string)
        : undefined;
    // Line-level filters. They narrow sales lines, bookings and the rankings;
    // payments and expenses are not tied to a staff member or item.
    const staffId = param("staffId");
    const serviceId = param("serviceId");
    const productId = param("productId");

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
      packages,
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
          ...(staffId
            ? { OR: [{ staffId }, { services: { some: { staffId } } }] }
            : {}),
          ...(serviceId ? { services: { some: { serviceId } } } : {}),
          // A product is never booked, so a product filter leaves no bookings.
          ...(productId ? { id: { in: [] } } : {}),
        },
        select: {
          status: true,
          walkInJobCart: true,
          startTime: true,
          customerId: true,
          estimatedAmount: true,
          staffId: true,
          staff: { select: { name: true } },
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
          ...(serviceId ? { serviceId } : {}),
          ...(productId ? { productId } : {}),
          // Same credit rule as the staff ranks below: appointment staff for
          // services, whoever billed it otherwise.
          ...(staffId
            ? {
                OR: [
                  { soldByStaffId: staffId },
                  { invoice: { is: { appointment: { is: { staffId } } } } },
                ],
              }
            : {}),
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
          sale: {
            is: {
              ...common,
              ...(range ? { saleDate: range } : {}),
              ...(staffId ? { staffId } : {}),
            },
          },
          ...(productId ? { productId } : {}),
          // Retail sales hold only products, so a service filter excludes them.
          ...(serviceId ? { id: { in: [] } } : {}),
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
        where: {
          ...common,
          ...(range ? { startsAt: range } : {}),
          ...(staffId ? { soldByStaffId: staffId } : {}),
          ...(serviceId || productId ? { id: { in: [] } } : {}),
        },
        select: {
          membershipId: true,
          membershipNameSnapshot: true,
          amountPaid: true,
          paymentMethod: true,
          durationMonthsSnapshot: true,
          status: true,
          soldByStaffId: true,
          soldByStaff: { select: { name: true } },
        },
      }),
      prisma.customer.findMany({
        where: { ...common, ...(range ? { createdAt: range } : {}) },
        select: { createdAt: true },
      }),
      prisma.customerPackage.findMany({
        where: {
          ...common,
          status: { not: "CANCELLED" },
          ...(range ? { purchasedAt: range } : {}),
          ...(staffId ? { soldByStaffId: staffId } : {}),
          ...(productId ? { id: { in: [] } } : {}),
          ...(serviceId
            ? { package: { is: { items: { some: { serviceId } } } } }
            : {}),
        },
        select: {
          specialPriceSnapshot: true,
          soldByStaffId: true,
          soldByStaff: { select: { name: true } },
        },
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
    // An open-ended custom range has no span, so it charts by month.
    const spanDays =
      start && end
        ? (end.getTime() - start.getTime()) / 86_400_000
        : Number.POSITIVE_INFINITY;
    const bucket = (date: Date) => {
      const key = trendBucket(localDay(date, timezone), spanDays);
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

    // "Preferred" = most bookings made with that stylist, ignoring bookings
    // that never happened. Amount is what those bookings were quoted at.
    const preferredStaff = ranker();
    for (const row of appointments) {
      if (row.status === "CANCELLED" || row.status === "NO_SHOW") continue;
      preferredStaff.add(row.staffId, row.staff?.name ?? "Unassigned", num(row.estimatedAmount));
    }
    const packageStaff = ranker();
    for (const row of packages) {
      packageStaff.add(
        row.soldByStaffId,
        row.soldByStaff?.name ?? "Unassigned",
        num(row.specialPriceSnapshot)
      );
    }
    const membershipStaff = ranker();
    for (const row of memberships) {
      membershipStaff.add(
        row.soldByStaffId,
        row.soldByStaff?.name ?? "Unassigned",
        num(row.amountPaid)
      );
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
        trendGranularity: trendGranularity(spanDays),
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
          preferredStaff: rankRows(preferredStaff.topByCount(10)),
          topPackageStaff: rankRows(packageStaff.top(10)),
          topMembershipStaff: rankRows(membershipStaff.top(10)),
        },
      },
    });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

/**
 * Sales dashboard: how many of each thing was sold in the window. Services
 * come from issued invoice lines, split by whether the bill came from an
 * appointment, a walk-in job cart, or neither (counter bill).
 */
export const getSalesDashboard = async (req: Request, res: Response) => {
  try {
    const { salonId, branchId } = await resolveScope(req);
    const { range, timezone, start, end } = await resolveRange(req, salonId);
    const common = {
      ...(salonId ? { salonId } : {}),
      ...(branchId ? { branchId } : {}),
    };

    const [
      invoiceItems,
      retailItems,
      packages,
      memberships,
      payments,
      salePayments,
      retailSales,
    ] = await Promise.all([
        prisma.invoiceItem.findMany({
          where: {
            itemType: { in: ["SERVICE", "PRODUCT"] },
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
            quantity: true,
            lineTotal: true,
            serviceId: true,
            serviceName: true,
            productId: true,
            product: { select: { name: true } },
            invoice: { select: { appointment: { select: { walkInJobCart: true } } } },
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
          },
        }),
        prisma.customerPackage.findMany({
          where: {
            ...common,
            status: { not: "CANCELLED" },
            ...(range ? { purchasedAt: range } : {}),
          },
          select: {
            specialPriceSnapshot: true,
            packageId: true,
            packageNameSnapshot: true,
          },
        }),
        prisma.customerMembership.findMany({
          where: {
            ...common,
            status: { notIn: ["CANCELLED", "REMOVED"] },
            ...(range ? { startsAt: range } : {}),
          },
          select: {
            amountPaid: true,
            membershipId: true,
            membershipNameSnapshot: true,
          },
        }),
        // The till, same three sources as the salon report's payment mix.
        prisma.payment.findMany({
          where: { ...common, ...(range ? { paidAt: range } : {}) },
          select: {
            amount: true,
            method: true,
            customerId: true,
            customer: { select: { name: true } },
          },
        }),
        prisma.salePayment.findMany({
          where: {
            ...(range ? { paidAt: range } : {}),
            sale: { is: { ...common, status: "ACTIVE" } },
          },
          select: {
            amount: true,
            method: true,
            sale: { select: { customerId: true, customerName: true } },
          },
        }),
        prisma.retailSale.findMany({
          where: { ...common, ...(range ? { saleDate: range } : {}) },
          select: {
            totalAmount: true,
            paymentMethod: true,
            customerId: true,
            customer: { select: { name: true } },
          },
        }),
      ]);

    const tally = () => ({ count: 0, amount: 0 });
    const services = { appointments: tally(), jobCarts: tally(), counter: tally() };
    const products = tally();
    const serviceRank = ranker();
    const productRank = ranker();
    const packageRank = ranker();
    const membershipRank = ranker();
    const methods = ranker();
    const customerRank = ranker();

    for (const item of invoiceItems) {
      const quantity = item.quantity ?? 1;
      const amount = num(item.lineTotal);
      const appointment = item.invoice?.appointment;
      if (item.itemType === "PRODUCT") {
        productRank.add(
          item.productId ?? item.serviceName,
          item.product?.name ?? item.serviceName,
          amount,
          quantity
        );
      } else {
        serviceRank.add(item.serviceId ?? item.serviceName, item.serviceName, amount, quantity);
      }
      const bucket =
        item.itemType === "PRODUCT"
          ? products
          : !appointment
            ? services.counter
            : appointment.walkInJobCart
              ? services.jobCarts
              : services.appointments;
      bucket.count += quantity;
      bucket.amount += amount;
    }
    for (const item of retailItems) {
      products.count += num(item.quantity);
      products.amount += num(item.totalPrice);
      productRank.add(
        item.productId,
        item.product?.name ?? "Product",
        num(item.totalPrice),
        num(item.quantity)
      );
    }
    for (const row of packages) {
      packageRank.add(row.packageId, row.packageNameSnapshot, num(row.specialPriceSnapshot));
    }
    for (const row of memberships) {
      membershipRank.add(row.membershipId, row.membershipNameSnapshot, num(row.amountPaid));
    }

    for (const row of payments) {
      methods.add(row.method, row.method, num(row.amount));
      customerRank.add(row.customerId, row.customer?.name ?? "Customer", num(row.amount));
    }
    for (const row of salePayments) {
      methods.add(row.method, row.method, num(row.amount));
      customerRank.add(row.sale?.customerId, row.sale?.customerName ?? "Customer", num(row.amount));
    }
    for (const row of retailSales) {
      const method = row.paymentMethod ?? "OTHER";
      methods.add(method, method, num(row.totalAmount));
      customerRank.add(row.customerId, row.customer?.name ?? "Customer", num(row.totalAmount));
    }

    // One row per issued invoice that sold services. Invoices carry no author
    // columns, so created/edited by come from the audit log: billing logs the
    // invoice itself, a job cart logs the appointment behind it.
    const serviceInvoices = await prisma.invoice.findMany({
      where: {
        ...common,
        status: "ISSUED",
        ...(range ? { invoiceDate: range } : {}),
        items: { some: { itemType: "SERVICE" } },
      },
      orderBy: { invoiceDate: "desc" },
      take: 500, // ponytail: capped list, paginate if a range ever exceeds it
      select: {
        id: true,
        invoiceCode: true,
        invoiceDate: true,
        appointmentId: true,
        customerName: true,
        items: { where: { itemType: "SERVICE" }, select: { lineTotal: true } },
        payments: { select: { method: true } },
      },
    });
    const authors = await invoiceAuthors(serviceInvoices);
    const serviceSales = serviceInvoices.map((row) => ({
      id: row.id,
      invoiceCode: row.invoiceCode,
      invoiceDate: row.invoiceDate,
      customerName: row.customerName,
      amount: row.items.reduce((sum, item) => sum + num(item.lineTotal), 0),
      paymentMethods: [...new Set(row.payments.map((payment) => payment.method))],
      ...authors.of(row),
    }));

    return res.json({
      success: true,
      data: {
        range: {
          from: start ? localDay(start, timezone) : null,
          to: end ? localDay(new Date(end.getTime() - 1), timezone) : null,
          timezone,
        },
        services,
        products,
        packages: {
          count: packages.length,
          amount: packages.reduce((sum, row) => sum + num(row.specialPriceSnapshot), 0),
        },
        memberships: {
          count: memberships.length,
          amount: memberships.reduce((sum, row) => sum + num(row.amountPaid), 0),
        },
        // Top lists rank by how many were sold; customers rank by what they paid.
        topServices: rankRows(serviceRank.topByCount(10)),
        // The service-wise record: every service billed in the window, ranked
        // by revenue, not just the top ten.
        // ponytail: capped list, paginate if a salon ever bills more than this
        serviceWise: rankRows(serviceRank.top(500)),
        topProducts: rankRows(productRank.topByCount(10)),
        topPackages: rankRows(packageRank.topByCount(10)),
        topMemberships: rankRows(membershipRank.topByCount(10)),
        topCustomers: rankRows(customerRank.top(10)),
        paymentMethods: methodRows(methods.top(20)),
        serviceSales,
      },
    });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

/** The seven local days ending on `endDay`, oldest first. */
export const trendDays = (endDay: string, days = 7) =>
  Array.from({ length: days }, (_, index) => {
    const date = new Date(`${endDay}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (days - 1 - index));
    return date.toISOString().slice(0, 10);
  });

/**
 * Billed total per local day for the week ending on `endDay`. Days with no
 * bills still appear, so the line has no gaps and the sparklines stay aligned.
 */
const trendSeries = async (
  scope: { salonId: string | undefined; branchId: string | undefined },
  endDay: string,
  timezone: string
) => {
  const days = trendDays(endDay);
  const bounds = parseSalonDateRange(days[0], endDay, timezone);
  const invoices = await prisma.invoice.findMany({
    where: {
      ...(scope.salonId ? { salonId: scope.salonId } : {}),
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      status: "ISSUED",
      ...(bounds.start ? { invoiceDate: { gte: bounds.start, ...(bounds.end ? { lt: bounds.end } : {}) } } : {}),
    },
    select: { invoiceDate: true, totalAmount: true },
  });
  const totals = new Map(days.map((day) => [day, { amount: 0, count: 0 }]));
  for (const invoice of invoices) {
    const bucket = totals.get(localDay(invoice.invoiceDate, timezone));
    if (!bucket) continue;
    bucket.amount += num(invoice.totalAmount);
    bucket.count += 1;
  }
  return days.map((day) => ({ day, ...totals.get(day)! }));
};

/**
 * Totals for the equally long window ending where this one starts, which is
 * what the "vs" figures on the tiles are measured against.
 */
const previousWindow = async (
  scope: { salonId: string | undefined; branchId: string | undefined },
  start: Date | null,
  end: Date | null
) => {
  if (!start || !end) return null;
  const span = end.getTime() - start.getTime();
  const totals = await prisma.invoice.aggregate({
    where: {
      ...(scope.salonId ? { salonId: scope.salonId } : {}),
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      status: "ISSUED",
      invoiceDate: { gte: new Date(start.getTime() - span), lt: start },
    },
    _sum: { totalAmount: true },
    _count: true,
  });
  return {
    totalBillingCost: num(totals._sum.totalAmount),
    totalSales: totals._count,
  };
};

/**
 * End-of-day cash-up: one row per issued invoice in the window, with the
 * service and product split the counter reconciles against. Defaults to the
 * salon's own today when no period is supplied.
 */
export const getEodReport = async (req: Request, res: Response) => {
  try {
    const { salonId, branchId } = await resolveScope(req);
    // An EOD report with no period means today, not the dashboard's month.
    const { range, timezone, start, end } = await resolveRange(req, salonId, "day");

    const invoices = await prisma.invoice.findMany({
      where: {
        ...(salonId ? { salonId } : {}),
        ...(branchId ? { branchId } : {}),
        status: "ISSUED",
        ...(range ? { invoiceDate: range } : {}),
        ...eodInvoiceFilters(req.query),
      },
      orderBy: { invoiceDate: "desc" },
      take: 500, // ponytail: capped list, paginate if a day ever exceeds it
      select: {
        id: true,
        invoiceCode: true,
        invoiceDate: true,
        appointmentId: true,
        customerName: true,
        customerPhone: true,
        totalAmount: true,
        billingNote: true,
        items: {
          select: { itemType: true, serviceName: true, lineTotal: true, quantity: true },
        },
        payments: { select: { method: true, amount: true } },
      },
    });
    const authors = await invoiceAuthors(invoices);

    const names = (items: typeof invoices[number]["items"], type: string) =>
      items.filter((item) => item.itemType === type).map((item) => item.serviceName);
    const cost = (items: typeof invoices[number]["items"], type: string) =>
      items
        .filter((item) => item.itemType === type)
        .reduce((sum, item) => sum + num(item.lineTotal), 0);

    const rows = invoices.map((row) => ({
      id: row.id,
      invoiceCode: row.invoiceCode,
      invoiceDate: row.invoiceDate,
      customerName: row.customerName,
      customerPhone: row.customerPhone,
      services: names(row.items, "SERVICE"),
      serviceCost: cost(row.items, "SERVICE"),
      products: names(row.items, "PRODUCT"),
      productCost: cost(row.items, "PRODUCT"),
      salesCost: num(row.totalAmount),
      paymentMethods: [...new Set(row.payments.map((payment) => payment.method))],
      comment: row.billingNote,
      ...authors.of(row),
    }));

    // Payments are split by how the money arrived: cash in the drawer versus
    // everything that lands in a bank or wallet, which is what gets counted
    // against the till at close.
    const modes = ranker();
    for (const invoice of invoices) {
      for (const payment of invoice.payments) {
        modes.add(payment.method, payment.method, num(payment.amount));
      }
    }
    const paymentModes = methodRows(modes.top(10));
    const cashReceived = paymentModes
      .filter((mode) => mode.method === "CASH")
      .reduce((sum, mode) => sum + mode.amount, 0);
    const onlineReceived = paymentModes
      .filter((mode) => mode.method !== "CASH")
      .reduce((sum, mode) => sum + mode.amount, 0);

    // Top sellers come out of the bills already in hand, so this costs no
    // extra query.
    const serviceRank = ranker();
    const productRank = ranker();
    for (const invoice of invoices) {
      for (const item of invoice.items) {
        const into = item.itemType === "SERVICE" ? serviceRank : item.itemType === "PRODUCT" ? productRank : null;
        into?.add(item.serviceName, item.serviceName, num(item.lineTotal), item.quantity);
      }
    }

    const endDay = end ? localDay(new Date(end.getTime() - 1), timezone) : localDay(new Date(), timezone);
    const [trend, previous] = await Promise.all([
      trendSeries({ salonId, branchId }, endDay, timezone),
      // Same-length window immediately before this one, so a one-day report
      // compares against yesterday and a range against the range before it.
      previousWindow({ salonId, branchId }, start, end),
    ]);

    const totalBillingCost = rows.reduce((sum, row) => sum + row.salesCost, 0);

    return res.json({
      success: true,
      data: {
        range: {
          from: start ? localDay(start, timezone) : null,
          to: end ? localDay(new Date(end.getTime() - 1), timezone) : null,
          timezone,
        },
        // The headline tiles: what was billed, how it was paid, how many bills.
        totalBillingCost,
        totalSales: rows.length,
        cashReceived,
        onlineReceived,
        paymentModes,
        topServices: rankRows(serviceRank.topByCount(5)),
        topProducts: rankRows(productRank.topByCount(5)),
        trend,
        previous,
        rows,
      },
    });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};
