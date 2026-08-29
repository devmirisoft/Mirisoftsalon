import { prisma } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { SalarySlipModel } from "./salarySlip.model.js";
import { getSalonMonthRange } from "../../utils/timezone.js";

const D = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value);
const money = (value: Prisma.Decimal) => value.toDecimalPlaces(2);

const dateKey = (date: Date) => date.toISOString().slice(0, 10);

const addLeaveDates = (
  target: Set<string>,
  startDate: Date,
  endDate: Date,
  rangeStart: Date,
  rangeEndExclusive: Date
) => {
  const start = new Date(Math.max(startDate.getTime(), rangeStart.getTime()));
  const inclusiveMonthEnd = new Date(rangeEndExclusive.getTime() - 1);
  const end = new Date(Math.min(endDate.getTime(), inclusiveMonthEnd.getTime()));
  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(0, 0, 0, 0);
  for (let current = start; current <= end; current = new Date(current.getTime() + 86_400_000)) {
    target.add(dateKey(current));
  }
};

export const generateSalarySlip = async (input: {
  salonId: string;
  staffId: string;
  month: number;
  year: number;
  bonusAmount: number;
  manualDeduction: number;
  note?: string;
}, tx?: Prisma.TransactionClient) => {
  const client = tx ?? prisma;
  const salon = await client.salon.findUnique({
    where: { id: input.salonId },
    select: { timezone: true },
  });
  if (!salon) throw Object.assign(new Error("Salon not found"), { status: 404 });
  const range = getSalonMonthRange(input.year, input.month, salon.timezone);
  const existing = await SalarySlipModel.findUniquePeriod(
    input.salonId,
    input.staffId,
    input.month,
    input.year,
    tx
  );
  if (existing && existing.status !== "CANCELLED") {
    throw Object.assign(new Error("A non-cancelled salary slip already exists for this period"), { status: 409 });
  }

  const config = await client.staffSalaryConfig.findFirst({
    where: {
      salonId: input.salonId,
      staffId: input.staffId,
      effectiveFrom: { lte: range.last },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: range.start } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!config) {
    throw Object.assign(new Error("No salary configuration is effective for this month"), { status: 400 });
  }

  const [attendance, leaves, serviceResult, retailResult] = await Promise.all([
    client.staffAttendance.findMany({
      where: { salonId: input.salonId, staffId: input.staffId, date: { gte: range.start, lt: range.end } },
    }),
    client.staffLeave.findMany({
      where: {
        salonId: input.salonId,
        staffId: input.staffId,
        status: "APPROVED",
        startDate: { lt: range.end },
        endDate: { gte: range.start },
      },
    }),
    client.invoiceItem.aggregate({
      where: {
        serviceId: { not: null },
        invoice: {
          salonId: input.salonId,
          status: "ISSUED",
          paymentStatus: "PAID",
          invoiceDate: { gte: range.start, lt: range.end },
          appointment: { is: { staffId: input.staffId, status: "COMPLETED" } },
        },
      },
      _sum: { lineTotal: true },
    }),
    client.retailSale.aggregate({
      where: {
        salonId: input.salonId,
        staffId: input.staffId,
        saleDate: { gte: range.start, lt: range.end },
      },
      _sum: { totalAmount: true },
    }),
  ]);

  const paidLeaveDates = new Set<string>();
  const unpaidLeaveDates = new Set<string>();
  for (const leave of leaves) {
    const target = leave.leaveType === "UNPAID_LEAVE" ? unpaidLeaveDates : paidLeaveDates;
    addLeaveDates(target, leave.startDate, leave.endDate, range.start, range.end);
  }

  let presentDays = 0;
  let halfDays = 0;
  let absentDays = 0;
  let lateDays = 0;
  let totalLateMinutes = 0;
  for (const row of attendance) {
    const key = dateKey(row.date);
    const isApprovedLeave = paidLeaveDates.has(key) || unpaidLeaveDates.has(key);
    if (row.status === "PRESENT") presentDays += 1;
    if (row.status === "LATE") {
      presentDays += 1;
      lateDays += 1;
      totalLateMinutes += row.lateMinutes;
    }
    if (row.status === "HALF_DAY") halfDays += 1;
    if (row.status === "ABSENT" && !isApprovedLeave) absentDays += 1;
    if (row.status === "PAID_LEAVE" && !isApprovedLeave) paidLeaveDates.add(key);
    if (row.status === "UNPAID_LEAVE" && !isApprovedLeave) unpaidLeaveDates.add(key);
  }

  const allowedPaid = Math.min(paidLeaveDates.size, config.paidLeavesAllowed);
  const excessPaid = Math.max(0, paidLeaveDates.size - config.paidLeavesAllowed);
  const paidLeaveDays = allowedPaid;
  const unpaidLeaveDays = unpaidLeaveDates.size + excessPaid;
  const configuredBase = D(config.baseSalary);
  const perDaySalary = money(
    config.salaryType === "DAILY"
      ? configuredBase
      : configuredBase.div(config.workingDaysPerMonth)
  );
  const salaryBase = money(
    config.salaryType === "DAILY"
      ? perDaySalary.mul(D(presentDays).plus(D(halfDays).mul(0.5)).plus(paidLeaveDays))
      : configuredBase
  );
  const unpaidLeaveDeduction = money(perDaySalary.mul(unpaidLeaveDays));
  const latePenalty = money(
    config.latePenaltyType === "FIXED_PER_LATE_DAY"
      ? D(config.latePenaltyAmount).mul(lateDays)
      : config.latePenaltyType === "PER_LATE_MINUTE"
        ? D(config.latePenaltyAmount).mul(totalLateMinutes)
        : D(0)
  );
  const serviceRevenue = money(D(serviceResult._sum.lineTotal ?? 0));
  const retailSalesRevenue = money(D(retailResult._sum.totalAmount ?? 0));
  const serviceCommissionAmount = money(
    serviceRevenue.gte(config.serviceMinimumWorkThreshold)
      ? serviceRevenue.mul(config.serviceCommissionPercentage).div(100)
      : D(0)
  );
  const retailCommissionAmount = money(
    retailSalesRevenue.gte(config.retailMinimumSalesThreshold)
      ? retailSalesRevenue.mul(config.retailCommissionPercentage).div(100)
      : D(0)
  );
  const bonus = money(D(input.bonusAmount));
  const manual = money(D(input.manualDeduction));
  const grossSalary = money(salaryBase.plus(serviceCommissionAmount).plus(retailCommissionAmount).plus(bonus));
  const netSalary = money(grossSalary.minus(unpaidLeaveDeduction).minus(latePenalty).minus(manual));

  return SalarySlipModel.saveGenerated(existing?.id, {
    salonId: input.salonId,
    staffId: input.staffId,
    ...(config.branchId ? { branchId: config.branchId } : {}),
    salaryConfigId: config.id,
    month: input.month,
    year: input.year,
    baseSalary: salaryBase,
    workingDays: config.workingDaysPerMonth,
    presentDays,
    halfDays,
    paidLeaveDays,
    unpaidLeaveDays,
    absentDays,
    lateDays,
    totalLateMinutes,
    perDaySalary,
    unpaidLeaveDeduction,
    latePenalty,
    manualDeduction: manual,
    bonusAmount: bonus,
    serviceRevenue,
    serviceMinimumWorkThreshold: config.serviceMinimumWorkThreshold,
    serviceCommissionPercentage: config.serviceCommissionPercentage,
    serviceCommissionAmount,
    retailSalesRevenue,
    retailMinimumSalesThreshold: config.retailMinimumSalesThreshold,
    retailCommissionPercentage: config.retailCommissionPercentage,
    retailCommissionAmount,
    grossSalary,
    netSalary,
    status: "GENERATED",
    ...(input.note ? { note: input.note } : {}),
  }, tx);
};
