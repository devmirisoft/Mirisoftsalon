import { type Request, type Response } from "express";
import { prisma } from "../../config/prisma.js";
import {
  branchScope,
  getSalonId,
  sendInventoryError,
  transactionError,
  validateBranch,
} from "../products/inventory-access.js";
import { ReportModel } from "./report.model.js";
import { paginationMeta, parsePagination } from "../../utils/pagination.js";
import { getSalonMonthRange, parseSalonDateRange } from "../../utils/timezone.js";

const resolveScope = async (req: Request) => {
  let salonId = getSalonId(req, req.query.salonId);
  const restrictedBranch =
    (req.user?.role === "BRANCH_MANAGER" ||
      req.user?.role === "RECEPTIONIST") &&
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

const dateRange = async (req: Request, salonId?: string) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  if (!from && !to) return undefined;
  const salon = salonId
    ? await prisma.salon.findUnique({ where: { id: salonId }, select: { timezone: true } })
    : null;
  try {
    const range = parseSalonDateRange(from, to, salon?.timezone ?? "Asia/Kolkata");
    return {
      ...(range.start ? { gte: range.start } : {}),
      ...(range.end ? { lt: range.end } : {}),
    };
  } catch {
    throw transactionError("Invalid date range");
  }
};

export const getInventoryReport = async (req: Request, res: Response) => {
  try {
    const { salonId, branchId } = await resolveScope(req);
    const products = await ReportModel.products({
      ...(salonId ? { salonId } : {}),
      ...(branchId
        ? { OR: [{ branchId }, { branchId: null }] }
        : req.user?.role === "BRANCH_MANAGER" ||
            req.user?.role === "RECEPTIONIST"
          ? branchScope(req)
          : {}),
    });
    const data = products.reduce(
      (report, product) => {
        const stock = Number(product.currentStock);
        report.totalStockQuantity += stock;
        report.totalStockCostValue += stock * Number(product.costPrice);
        report.totalRetailValue += stock * Number(product.sellingPrice);
        if (
          product.status &&
          Number(product.lowStockAlert) > 0 &&
          stock <= Number(product.lowStockAlert)
        ) {
          report.lowStockCount += 1;
        }
        return report;
      },
      {
        totalProducts: products.length,
        totalStockQuantity: 0,
        totalStockCostValue: 0,
        totalRetailValue: 0,
        lowStockCount: 0,
      }
    );
    return res.json({ success: true, data });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

export const getExpenseReport = async (req: Request, res: Response) => {
  try {
    const { salonId, branchId } = await resolveScope(req);
    const range = await dateRange(req, salonId);
    const expenses = await ReportModel.expenses({
      ...(salonId ? { salonId } : {}),
      ...(branchId ? { branchId } : {}),
      ...(range ? { expenseDate: range } : {}),
    });
    const categoryTotals = new Map<string, number>();
    const monthTotals = new Map<string, number>();
    const branchTotals = new Map<string, { branchId: string | null; total: number }>();
    let totalExpenses = 0;
    for (const expense of expenses) {
      const amount = Number(expense.amount);
      totalExpenses += amount;
      categoryTotals.set(
        expense.category,
        (categoryTotals.get(expense.category) ?? 0) + amount
      );
      const month = expense.expenseDate.toISOString().slice(0, 7);
      monthTotals.set(month, (monthTotals.get(month) ?? 0) + amount);
      const branchName = expense.branch?.name ?? "All branches";
      const current = branchTotals.get(branchName);
      branchTotals.set(branchName, {
        branchId: expense.branchId,
        total: (current?.total ?? 0) + amount,
      });
    }
    return res.json({
      success: true,
      data: {
        totalExpenses,
        expensesByCategory: Array.from(categoryTotals, ([category, total]) => ({
          category,
          total,
        })),
        expensesByMonth: Array.from(monthTotals, ([month, total]) => ({
          month,
          total,
        })),
        expensesByBranch: Array.from(branchTotals, ([branch, value]) => ({
          branch,
          ...value,
        })),
      },
    });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};

export const getStaffPerformance = async (req: Request, res: Response) => {
  try {
    const pagination = parsePagination(req.query);
    if ("error" in pagination) throw transactionError(pagination.error);
    const month = Number(req.query.month);
    const year = Number(req.query.year);
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) {
      throw transactionError("Valid month and year are required");
    }
    const { salonId, branchId } = await resolveScope(req);
    const salon = salonId
      ? await prisma.salon.findUnique({ where: { id: salonId }, select: { timezone: true } })
      : null;
    const { start, end } = getSalonMonthRange(year, month, salon?.timezone ?? "Asia/Kolkata");
    const common = {
      ...(salonId ? { salonId } : {}),
      ...(branchId ? { branchId } : {}),
    };
    const [total, staff, appointments, attendance, leaves, retailSales, invoiceItems, slips] =
      await Promise.all([
        prisma.staff.count({ where: common }),
        prisma.staff.findMany({
          where: common,
          select: {
            id: true,
            staffCode: true,
            name: true,
            jobRole: true,
            branch: { select: { id: true, name: true } },
          },
          orderBy: { name: "asc" },
          skip: pagination.skip,
          take: pagination.limit,
        }),
        prisma.appointment.findMany({
          where: { ...common, startTime: { gte: start, lt: end }, status: { in: ["COMPLETED", "CANCELLED"] } },
          select: { staffId: true, status: true },
        }),
        prisma.staffAttendance.findMany({
          where: { ...common, date: { gte: start, lt: end } },
          select: { staffId: true, status: true },
        }),
        prisma.staffLeave.findMany({
          where: { ...common, status: "APPROVED", startDate: { lt: end }, endDate: { gte: start } },
          select: { staffId: true, leaveType: true, startDate: true, endDate: true },
        }),
        prisma.retailSale.findMany({
          where: { ...common, staffId: { not: null }, saleDate: { gte: start, lt: end } },
          select: { staffId: true, totalAmount: true },
        }),
        prisma.invoiceItem.findMany({
          where: {
            serviceId: { not: null },
            invoice: {
              ...common,
              status: "ISSUED",
              paymentStatus: "PAID",
              invoiceDate: { gte: start, lt: end },
              appointment: { is: { status: "COMPLETED" } },
            },
          },
          select: {
            lineTotal: true,
            invoice: { select: { appointment: { select: { staffId: true } } } },
          },
        }),
        prisma.salarySlip.findMany({
          where: { ...common, month, year, status: { not: "CANCELLED" } },
        }),
      ]);

    const rows = staff.map((person) => {
      const personAppointments = appointments.filter((row) => row.staffId === person.id);
      const personAttendance = attendance.filter((row) => row.staffId === person.id);
      const personLeaves = leaves.filter((row) => row.staffId === person.id);
      const leaveDays = (types: string[]) => {
        const dates = new Set<string>();
        for (const leave of personLeaves.filter((row) => types.includes(row.leaveType))) {
          const first = new Date(Math.max(leave.startDate.getTime(), start.getTime()));
          const last = new Date(Math.min(leave.endDate.getTime(), end.getTime() - 1));
          first.setUTCHours(0, 0, 0, 0);
          last.setUTCHours(0, 0, 0, 0);
          for (let day = first; day <= last; day = new Date(day.getTime() + 86_400_000)) {
            dates.add(day.toISOString().slice(0, 10));
          }
        }
        return dates.size;
      };
      const slip = slips.find((row) => row.staffId === person.id);
      const serviceRevenue = invoiceItems
        .filter((row) => row.invoice.appointment?.staffId === person.id)
        .reduce((sum, row) => sum + Number(row.lineTotal), 0);
      const retailSalesRevenue = retailSales
        .filter((row) => row.staffId === person.id)
        .reduce((sum, row) => sum + Number(row.totalAmount), 0);
      return {
        staffId: person.id,
        staffCode: person.staffCode,
        name: person.name,
        jobRole: person.jobRole,
        branch: person.branch,
        completedAppointments: personAppointments.filter((row) => row.status === "COMPLETED").length,
        cancelledAppointments: personAppointments.filter((row) => row.status === "CANCELLED").length,
        serviceRevenue,
        retailSalesRevenue,
        serviceCommissionAmount: Number(slip?.serviceCommissionAmount ?? 0),
        retailCommissionAmount: Number(slip?.retailCommissionAmount ?? 0),
        presentDays: personAttendance.filter((row) => row.status === "PRESENT" || row.status === "LATE").length,
        lateDays: personAttendance.filter((row) => row.status === "LATE").length,
        paidLeaveDays: leaveDays(["PAID_LEAVE", "SICK_LEAVE", "CASUAL_LEAVE"]),
        unpaidLeaveDays: leaveDays(["UNPAID_LEAVE"]),
        absentDays: personAttendance.filter((row) => row.status === "ABSENT").length,
        netSalary: slip ? Number(slip.netSalary) : null,
        salaryStatus: slip?.status ?? null,
      };
    });
    return res.json({
      success: true,
      message: "Staff performance report fetched successfully",
      data: rows,
      pagination: paginationMeta(pagination.page, pagination.limit, total),
    });
  } catch (error) {
    return sendInventoryError(res, error);
  }
};
