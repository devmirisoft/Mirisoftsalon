import { type Request } from "express";
import { prisma } from "../../config/prisma.js";
import {
  MAX_EXPORT_ROWS,
  type ReportExportDocument,
} from "../../utils/export/reportExportTypes.js";
import { getSalonMonthRange, parseSalonDateRange } from "../../utils/timezone.js";
import { transactionError, validateBranch } from "../products/inventory-access.js";

export const EXPORT_REPORT_TYPES = [
  "revenue",
  "expenses",
  "salon-report",
  "inventory",
  "low-stock",
  "staff-performance",
  "payroll",
  "customer-outstanding",
  "appointments",
] as const;
export type ExportReportType = (typeof EXPORT_REPORT_TYPES)[number];

const allowedRoles: Record<ExportReportType, string[]> = {
  revenue: ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST"],
  expenses: ["SUPER_ADMIN", "SALON_ADMIN"],
  "salon-report": ["SUPER_ADMIN", "SALON_ADMIN"],
  inventory: ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST", "STAFF"],
  "low-stock": ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST", "STAFF"],
  "staff-performance": ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER"],
  payroll: ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "STAFF"],
  "customer-outstanding": ["SUPER_ADMIN", "SALON_ADMIN", "RECEPTIONIST", "STAFF"],
  appointments: ["SUPER_ADMIN", "SALON_ADMIN", "RECEPTIONIST", "STAFF"],
};

const clean = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const numberValue = (value: unknown) => Number(value ?? 0);

const limited = <T>(rows: T[]) => {
  if (rows.length > MAX_EXPORT_ROWS) {
    throw transactionError(
      `Export exceeds the ${MAX_EXPORT_ROWS.toLocaleString()} row limit. Narrow the filters.`,
      413
    );
  }
  return rows;
};

const resolveContext = async (req: Request) => {
  if (!req.user) throw transactionError("Unauthorized", 401);
  const requestedSalonId = clean(req.query.salonId);
  let salonId =
    req.user.role === "SUPER_ADMIN" ? requestedSalonId : req.user.salonId;
  let branchId =
    (req.user.role === "BRANCH_MANAGER" || req.user.role === "RECEPTIONIST") &&
    req.user.branchId
      ? req.user.branchId
      : clean(req.query.branchId);
  if (!salonId && branchId) {
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { salonId: true },
    });
    salonId = branch?.salonId;
  }
  if (!salonId) throw transactionError("Salon is required");
  if (!(await validateBranch(salonId, branchId))) {
    throw transactionError("Invalid branch for this salon", 403);
  }
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { name: true, timezone: true },
  });
  if (!salon) throw transactionError("Salon not found", 404);
  const branch = branchId
    ? await prisma.branch.findUnique({
        where: { id: branchId },
        select: { name: true },
      })
    : null;
  const from = clean(req.query.from);
  const to = clean(req.query.to);
  let range: { gte?: Date; lt?: Date } | undefined;
  try {
    const parsed = parseSalonDateRange(from, to, salon.timezone);
    range =
      parsed.start || parsed.end
        ? {
            ...(parsed.start ? { gte: parsed.start } : {}),
            ...(parsed.end ? { lt: parsed.end } : {}),
          }
        : undefined;
  } catch {
    throw transactionError("Invalid date range");
  }
  return {
    salonId,
    branchId,
    salonName: salon.name,
    branchName: branch?.name ?? "All branches",
    timezone: salon.timezone,
    range,
    filters: {
      ...(from ? { From: from } : {}),
      ...(to ? { To: to } : {}),
      ...(clean(req.query.month) ? { Month: clean(req.query.month)! } : {}),
      ...(clean(req.query.year) ? { Year: clean(req.query.year)! } : {}),
      ...(clean(req.query.status) ? { Status: clean(req.query.status)! } : {}),
    },
  };
};

const base = (
  reportType: string,
  title: string,
  context: Awaited<ReturnType<typeof resolveContext>>
) => ({
  reportType,
  title,
  salonName: context.salonName,
  branchName: context.branchName,
  timezone: context.timezone,
  generatedAt: new Date(),
  filters: context.filters,
});

export const buildReportExport = async (
  req: Request,
  reportType: ExportReportType
): Promise<ReportExportDocument & { salonId: string; branchId?: string }> => {
  if (!req.user || !allowedRoles[reportType].includes(req.user.role)) {
    throw transactionError("Forbidden", 403);
  }
  const context = await resolveContext(req);
  const common = {
    salonId: context.salonId,
    ...(context.branchId ? { branchId: context.branchId } : {}),
  };
  const result = await buildRows(reportType, context, common, req);
  return {
    ...base(reportType, result.title, context),
    columns: result.columns,
    rows: result.rows,
    ...(result.totals ? { totals: result.totals } : {}),
    salonId: context.salonId,
    ...(context.branchId ? { branchId: context.branchId } : {}),
  };
};

type Context = Awaited<ReturnType<typeof resolveContext>>;
type RowResult = Pick<ReportExportDocument, "title" | "columns" | "rows" | "totals">;

const buildRows = async (
  reportType: ExportReportType,
  context: Context,
  common: { salonId: string; branchId?: string },
  req: Request
): Promise<RowResult> => {
  if (reportType === "revenue") {
    const rows = limited(await prisma.sale.findMany({
      where: { ...common, status: "ACTIVE", ...(context.range ? { saleDate: context.range } : {}) },
      select: { saleCode: true, saleDate: true, customerName: true, staffName: true, totalAmount: true, paidAmount: true, dueAmount: true, paymentStatus: true, branch: { select: { name: true } } },
      orderBy: { saleDate: "asc" },
      take: MAX_EXPORT_ROWS + 1,
    }));
    return {
      title: "Billing & Payments Report",
      columns: [
        { key: "code", label: "Sale", width: 16 }, { key: "date", label: "Date", type: "date", width: 16 },
        { key: "customer", label: "Customer", width: 20 }, { key: "staff", label: "Staff", width: 18 },
        { key: "branch", label: "Branch", width: 16 }, { key: "total", label: "Total", type: "currency", width: 14 },
        { key: "paid", label: "Paid", type: "currency", width: 14 }, { key: "due", label: "Due", type: "currency", width: 14 },
        { key: "status", label: "Payment", width: 14 },
      ],
      rows: rows.map((row) => ({ code: row.saleCode, date: row.saleDate, customer: row.customerName, staff: row.staffName, branch: row.branch?.name ?? "All branches", total: Number(row.totalAmount), paid: Number(row.paidAmount), due: Number(row.dueAmount), status: row.paymentStatus })),
      totals: { code: "TOTAL", total: rows.reduce((s, r) => s + Number(r.totalAmount), 0), paid: rows.reduce((s, r) => s + Number(r.paidAmount), 0), due: rows.reduce((s, r) => s + Number(r.dueAmount), 0) },
    };
  }
  if (reportType === "expenses") {
    const rows = limited(await prisma.expense.findMany({
      where: { ...common, ...(context.range ? { expenseDate: context.range } : {}) },
      include: { branch: { select: { name: true } }, vendor: { select: { name: true } } },
      orderBy: { expenseDate: "asc" }, take: MAX_EXPORT_ROWS + 1,
    }));
    return { title: "Expense Report", columns: [
      { key: "date", label: "Date", type: "date" }, { key: "title", label: "Expense", width: 22 },
      { key: "category", label: "Category", width: 18 }, { key: "vendor", label: "Vendor", width: 18 },
      { key: "branch", label: "Branch", width: 16 }, { key: "method", label: "Method", width: 12 },
      { key: "amount", label: "Amount", type: "currency", width: 14 },
    ], rows: rows.map((r) => ({ date: r.expenseDate, title: r.title, category: r.category, vendor: r.vendor?.name ?? "", branch: r.branch?.name ?? "All branches", method: r.paymentMethod ?? "", amount: Number(r.amount) })),
    totals: { title: "TOTAL", amount: rows.reduce((s, r) => s + Number(r.amount), 0) } };
  }
  if (reportType === "salon-report") {
    const [sales, retail, purchases, expenses, payments, salePayments, memberships, customers, appointments] =
      await Promise.all([
        prisma.sale.aggregate({ where: { ...common, status: "ACTIVE", ...(context.range ? { saleDate: context.range } : {}) }, _sum: { totalAmount: true } }),
        prisma.retailSale.findMany({ where: { ...common, ...(context.range ? { saleDate: context.range } : {}) }, select: { totalAmount: true, paymentMethod: true } }),
        prisma.productPurchase.aggregate({ where: { ...common, ...(context.range ? { purchaseDate: context.range } : {}) }, _sum: { totalAmount: true } }),
        prisma.expense.aggregate({ where: { ...common, ...(context.range ? { expenseDate: context.range } : {}) }, _sum: { amount: true } }),
        prisma.payment.findMany({ where: { ...common, ...(context.range ? { paidAt: context.range } : {}) }, select: { amount: true, method: true } }),
        prisma.salePayment.findMany({ where: { ...(context.range ? { paidAt: context.range } : {}), sale: { is: { ...common, status: "ACTIVE" } } }, select: { amount: true, method: true } }),
        prisma.customerMembership.findMany({ where: { ...common, ...(context.range ? { startsAt: context.range } : {}) }, select: { amountPaid: true } }),
        prisma.customer.count({ where: { ...common, ...(context.range ? { createdAt: context.range } : {}) } }),
        prisma.appointment.findMany({ where: { ...common, ...(context.range ? { startTime: context.range } : {}) }, select: { walkInJobCart: true } }),
      ]);
    const retailTotal = retail.reduce((sum, row) => sum + numberValue(row.totalAmount), 0);
    const servicePayments = payments.reduce((sum, row) => sum + numberValue(row.amount), 0);
    const saleTotal = numberValue(sales._sum.totalAmount);
    const purchaseTotal = numberValue(purchases._sum.totalAmount);
    const expenseTotal = numberValue(expenses._sum.amount);
    const methodTotals = new Map<string, number>();
    for (const row of [...payments, ...salePayments]) {
      methodTotals.set(row.method, (methodTotals.get(row.method) ?? 0) + numberValue(row.amount));
    }
    for (const row of retail) {
      const method = row.paymentMethod ?? "OTHER";
      methodTotals.set(method, (methodTotals.get(method) ?? 0) + numberValue(row.totalAmount));
    }
    const metrics: [string, number][] = [
      ["Service payments", servicePayments],
      ["Sale revenue", saleTotal],
      ["Retail sales", retailTotal],
      ["Product purchases", -purchaseTotal],
      ["Expenses", -expenseTotal],
      ["Memberships sold", memberships.length],
      ["Membership revenue", memberships.reduce((sum, row) => sum + numberValue(row.amountPaid), 0)],
      ["New customers", customers],
      ["Appointments", appointments.filter((row) => !row.walkInJobCart).length],
      ["Job cards", appointments.filter((row) => row.walkInJobCart).length],
      ...Array.from(methodTotals, ([method, total]): [string, number] => [`Paid via ${method}`, total]),
    ];
    return { title: "Salon Report", columns: [{ key: "metric", label: "Metric", width: 28 }, { key: "amount", label: "Amount", type: "currency", width: 18 }], rows: metrics.map(([metric, amount]) => ({ metric, amount })),
      totals: { metric: "NET EARNINGS", amount: servicePayments + saleTotal + retailTotal - purchaseTotal - expenseTotal } };
  }
  if (reportType === "inventory" || reportType === "low-stock") {
    let products = limited(await prisma.product.findMany({
      where: { salonId: context.salonId, ...(context.branchId ? { OR: [{ branchId: context.branchId }, { branchId: null }] } : {}) },
      include: { branch: { select: { name: true } }, brand: { select: { name: true } } },
      orderBy: { name: "asc" }, take: MAX_EXPORT_ROWS + 1,
    }));
    if (reportType === "low-stock") products = products.filter((p) => p.status && Number(p.lowStockAlert) > 0 && Number(p.currentStock) <= Number(p.lowStockAlert));
    return { title: reportType === "inventory" ? "Inventory Report" : "Low Stock Report", columns: [
      { key: "product", label: "Product", width: 22 }, { key: "sku", label: "SKU", width: 14 },
      { key: "brand", label: "Brand", width: 16 }, { key: "branch", label: "Branch", width: 16 },
      { key: "stock", label: "Current Stock", type: "number" }, { key: "threshold", label: "Low Stock At", type: "number" },
      { key: "cost", label: "Cost Price", type: "currency" }, { key: "retail", label: "Selling Price", type: "currency" },
      { key: "stockValue", label: "Stock Value", type: "currency" },
    ], rows: products.map((p) => ({ product: p.name, sku: p.sku, brand: p.brand?.name ?? "", branch: p.branch?.name ?? "All branches", stock: Number(p.currentStock), threshold: Number(p.lowStockAlert), cost: Number(p.costPrice), retail: Number(p.sellingPrice), stockValue: Number(p.currentStock) * Number(p.costPrice) })),
    totals: { product: "TOTAL", stock: products.reduce((s, p) => s + Number(p.currentStock), 0), stockValue: products.reduce((s, p) => s + Number(p.currentStock) * Number(p.costPrice), 0) } };
  }
  if (reportType === "payroll") {
    const month = clean(req.query.month) ? Number(req.query.month) : undefined;
    const year = clean(req.query.year) ? Number(req.query.year) : undefined;
    let staffId = clean(req.query.staffId);
    if (req.user?.role === "STAFF") {
      const staff = await prisma.staff.findUnique({ where: { userId: req.user.userId }, select: { id: true } });
      staffId = staff?.id ?? "__none__";
    }
    const slips = limited(await prisma.salarySlip.findMany({
      where: { ...common, ...(month ? { month } : {}), ...(year ? { year } : {}), ...(staffId ? { staffId } : {}) },
      include: { staff: { select: { name: true, staffCode: true } }, branch: { select: { name: true } } },
      orderBy: [{ year: "desc" }, { month: "desc" }], take: MAX_EXPORT_ROWS + 1,
    }));
    return { title: "Salary Slips Report", columns: [
      { key: "period", label: "Period" }, { key: "staff", label: "Staff", width: 20 }, { key: "code", label: "Code" },
      { key: "branch", label: "Branch" }, { key: "gross", label: "Gross", type: "currency" },
      { key: "deductions", label: "Deductions", type: "currency" }, { key: "bonus", label: "Bonus", type: "currency" },
      { key: "net", label: "Net Salary", type: "currency" }, { key: "status", label: "Status" },
    ], rows: slips.map((s) => ({ period: `${String(s.month).padStart(2, "0")}/${s.year}`, staff: s.staff.name, code: s.staff.staffCode, branch: s.branch?.name ?? "All branches", gross: Number(s.grossSalary), deductions: Number(s.unpaidLeaveDeduction) + Number(s.latePenalty) + Number(s.manualDeduction), bonus: Number(s.bonusAmount), net: Number(s.netSalary), status: s.status })),
    totals: { period: "TOTAL", gross: slips.reduce((a, s) => a + Number(s.grossSalary), 0), deductions: slips.reduce((a, s) => a + Number(s.unpaidLeaveDeduction) + Number(s.latePenalty) + Number(s.manualDeduction), 0), bonus: slips.reduce((a, s) => a + Number(s.bonusAmount), 0), net: slips.reduce((a, s) => a + Number(s.netSalary), 0) } };
  }
  if (reportType === "customer-outstanding") {
    const customers = limited(await prisma.customer.findMany({
      where: common,
      include: { branch: { select: { name: true } } },
      orderBy: { name: "asc" }, take: MAX_EXPORT_ROWS + 1,
    }));
    return { title: "Customer Report", columns: [
      { key: "code", label: "Code" }, { key: "customer", label: "Customer", width: 22 },
      { key: "phone", label: "Phone", width: 16 }, { key: "branch", label: "Branch", width: 16 },
      { key: "outstanding", label: "Outstanding", type: "currency" }, { key: "wallet", label: "Wallet", type: "currency" },
    ], rows: customers.map((c) => ({ code: c.customerCode, customer: c.name, phone: c.phone, branch: c.branch?.name ?? "All branches", outstanding: Number(c.outstandingAmount), wallet: Number(c.walletBalance) })),
    totals: { code: "TOTAL", outstanding: customers.reduce((s, c) => s + Number(c.outstandingAmount), 0), wallet: customers.reduce((s, c) => s + Number(c.walletBalance), 0) } };
  }
  if (reportType === "appointments") {
    const status = clean(req.query.status);
    const staffId = clean(req.query.staffId);
    const appointments = limited(await prisma.appointment.findMany({
      where: { ...common, ...(context.range ? { startTime: context.range } : {}), ...(status ? { status: status as never } : {}), ...(staffId ? { staffId } : {}) },
      include: { customer: { select: { name: true, phone: true } }, staff: { select: { name: true } }, branch: { select: { name: true } }, services: { select: { serviceName: true } } },
      orderBy: { startTime: "asc" }, take: MAX_EXPORT_ROWS + 1,
    }));
    return { title: "Appointment Report", columns: [
      { key: "code", label: "Appointment" }, { key: "start", label: "Start", type: "date", width: 17 },
      { key: "customer", label: "Customer", width: 20 }, { key: "phone", label: "Phone" },
      { key: "staff", label: "Staff" }, { key: "services", label: "Services", width: 28 },
      { key: "branch", label: "Branch" }, { key: "amount", label: "Estimated", type: "currency" },
      { key: "status", label: "Status" },
    ], rows: appointments.map((a) => ({ code: a.appointmentCode, start: a.startTime, customer: a.customer.name, phone: a.customer.phone, staff: a.staff?.name ?? "Unassigned", services: a.services.map((s) => s.serviceName).join(", "), branch: a.branch?.name ?? "All branches", amount: Number(a.estimatedAmount), status: a.status })),
    totals: { code: "TOTAL", amount: appointments.reduce((s, a) => s + Number(a.estimatedAmount), 0) } };
  }

  const month = Number(req.query.month);
  const year = Number(req.query.year);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) {
    throw transactionError("Valid month and year are required");
  }
  const staff = limited(await prisma.staff.findMany({
    where: common, include: { branch: { select: { name: true } } }, orderBy: { name: "asc" }, take: MAX_EXPORT_ROWS + 1,
  }));
  const { start, end } = getSalonMonthRange(year, month, context.timezone);
  const [appointments, attendance, slips] = await Promise.all([
    prisma.appointment.findMany({ where: { ...common, startTime: { gte: start, lt: end } }, select: { staffId: true, status: true, estimatedAmount: true } }),
    prisma.staffAttendance.findMany({ where: { ...common, date: { gte: start, lt: end } }, select: { staffId: true, status: true } }),
    prisma.salarySlip.findMany({ where: { ...common, month, year, status: { not: "CANCELLED" } } }),
  ]);
  return { title: "Staff Performance Report", columns: [
    { key: "staff", label: "Staff", width: 20 }, { key: "role", label: "Role" }, { key: "branch", label: "Branch" },
    { key: "completed", label: "Completed", type: "number" }, { key: "cancelled", label: "Cancelled", type: "number" },
    { key: "revenue", label: "Est. Revenue", type: "currency" }, { key: "present", label: "Present", type: "number" },
    { key: "late", label: "Late", type: "number" }, { key: "net", label: "Net Salary", type: "currency" },
  ], rows: staff.map((person) => {
    const appts = appointments.filter((a) => a.staffId === person.id);
    const days = attendance.filter((a) => a.staffId === person.id);
    const slip = slips.find((s) => s.staffId === person.id);
    return { staff: person.name, role: person.jobRole, branch: person.branch?.name ?? "All branches", completed: appts.filter((a) => a.status === "COMPLETED").length, cancelled: appts.filter((a) => a.status === "CANCELLED").length, revenue: appts.filter((a) => a.status === "COMPLETED").reduce((s, a) => s + Number(a.estimatedAmount), 0), present: days.filter((d) => d.status === "PRESENT" || d.status === "LATE").length, late: days.filter((d) => d.status === "LATE").length, net: slip ? Number(slip.netSalary) : 0 };
  }) };
};
