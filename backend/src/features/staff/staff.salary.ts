import type { Prisma } from "../../generated/prisma/client.js";
import type { LatePenaltyType, SalaryType } from "../../generated/prisma/enums.js";

export const SALARY_TYPES = ["MONTHLY", "DAILY"] as const satisfies readonly SalaryType[];
export const LATE_PENALTY_TYPES = [
  "NONE",
  "FIXED_PER_LATE_DAY",
  "PER_LATE_MINUTE",
] as const satisfies readonly LatePenaltyType[];

const NUMBER_FIELDS = [
  "baseSalary",
  "paidLeavesAllowed",
  "lateGraceMinutes",
  "latePenaltyAmount",
  "serviceCommissionPercentage",
  "serviceMinimumWorkThreshold",
  "retailCommissionPercentage",
  "retailMinimumSalesThreshold",
] as const;

const ENUM_FIELDS = ["salaryType", "latePenaltyType"] as const;

const SALARY_KEYS = [
  ...NUMBER_FIELDS,
  ...ENUM_FIELDS,
  "workingDaysPerMonth",
  "effectiveFrom",
] as const;

export type SalaryValues = {
  baseSalary?: number;
  workingDaysPerMonth?: number;
  salaryType?: SalaryType;
  paidLeavesAllowed?: number;
  lateGraceMinutes?: number;
  latePenaltyType?: LatePenaltyType;
  latePenaltyAmount?: number;
  serviceCommissionPercentage?: number;
  serviceMinimumWorkThreshold?: number;
  retailCommissionPercentage?: number;
  retailMinimumSalesThreshold?: number;
  effectiveFrom?: Date;
};

export const hasSalaryInput = (body: Record<string, unknown>) =>
  SALARY_KEYS.some((key) => body[key] !== undefined && body[key] !== null && body[key] !== "");

export const validateSalaryInput = (body: Record<string, unknown>) => {
  for (const field of NUMBER_FIELDS) {
    if (body[field] !== undefined) {
      const value = Number(body[field]);
      if (!Number.isFinite(value) || value < 0) {
        return `${field} must be a non-negative number`;
      }
    }
  }

  if (
    body.workingDaysPerMonth !== undefined &&
    (!Number.isInteger(Number(body.workingDaysPerMonth)) ||
      Number(body.workingDaysPerMonth) <= 0)
  ) {
    return "workingDaysPerMonth must be a positive integer";
  }

  if (body.salaryType !== undefined && !SALARY_TYPES.includes(body.salaryType as SalaryType)) {
    return "Invalid salaryType";
  }

  if (
    body.latePenaltyType !== undefined &&
    !LATE_PENALTY_TYPES.includes(body.latePenaltyType as LatePenaltyType)
  ) {
    return "Invalid latePenaltyType";
  }

  if (body.effectiveFrom !== undefined) {
    const date = new Date(String(body.effectiveFrom));
    if (Number.isNaN(date.getTime())) return "Invalid effectiveFrom";
  }

  return null;
};

export const salaryValues = (body: Record<string, unknown>): SalaryValues => ({
  ...Object.fromEntries(
    NUMBER_FIELDS.filter((field) => body[field] !== undefined).map((field) => [
      field,
      Number(body[field]),
    ])
  ),
  ...(body.workingDaysPerMonth !== undefined
    ? { workingDaysPerMonth: Number(body.workingDaysPerMonth) }
    : {}),
  ...(body.salaryType !== undefined ? { salaryType: body.salaryType as SalaryType } : {}),
  ...(body.latePenaltyType !== undefined
    ? { latePenaltyType: body.latePenaltyType as LatePenaltyType }
    : {}),
  ...(body.effectiveFrom !== undefined
    ? { effectiveFrom: new Date(String(body.effectiveFrom)) }
    : {}),
});

export const salaryAuditData = (config: Record<string, unknown>) =>
  Object.fromEntries(SALARY_KEYS.map((key) => [key, config[key]]));

// A staff edit resubmits the whole prefilled form, so an unchanged salary block
// must not open a new effective-dated revision on every save.
export const isSameSalary = (
  config: Record<string, unknown>,
  values: SalaryValues
) =>
  SALARY_KEYS.every((key) => {
    const next = values[key as keyof SalaryValues];
    if (next === undefined) return true;
    if (key === "effectiveFrom") {
      return new Date(String(config[key])).getTime() === (next as Date).getTime();
    }
    if ((ENUM_FIELDS as readonly string[]).includes(key)) return config[key] === next;
    return Number(config[key]) === Number(next);
  });

// Effective-dated: activating a revision closes the previous one the day before.
export const createSalaryConfig = async (
  tx: Prisma.TransactionClient,
  data: Required<Pick<SalaryValues, "baseSalary" | "workingDaysPerMonth" | "effectiveFrom">> &
    SalaryValues & { salonId: string; staffId: string; branchId?: string }
) => {
  await tx.staffSalaryConfig.updateMany({
    where: { salonId: data.salonId, staffId: data.staffId, status: true },
    data: { status: false, effectiveTo: new Date(data.effectiveFrom.getTime() - 1) },
  });
  return tx.staffSalaryConfig.create({ data });
};
