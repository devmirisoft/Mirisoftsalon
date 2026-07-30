import { prisma } from "../../../config/prisma.js";
import type { AiTool } from "../ai-tool.types.js";
import { aiExactBranchScope } from "../ai-permission.service.js";

const EXPIRY_WINDOW_DAYS = 30;
const MAX_PACKAGES = 10;

export const getPackageExpirySummaryTool: AiTool = {
  name: "getPackageExpirySummary",
  description: "Returns customer packages expiring in the next 30 days.",
  allowedRoles: [
    "SUPER_ADMIN",
    "SALON_ADMIN",
    "BRANCH_MANAGER",
    "RECEPTIONIST",
  ],

  async run({ context }) {
    const now = new Date();
    const cutoff = new Date(
      now.getTime() + EXPIRY_WINDOW_DAYS * 24 * 60 * 60 * 1_000
    );
    const where = {
      ...(context.salonId ? { salonId: context.salonId } : {}),
      ...aiExactBranchScope(context),
      status: "ACTIVE" as const,
      validUntil: { gte: now, lte: cutoff },
    };
    const [packages, total] = await Promise.all([
      prisma.customerPackage.findMany({
        where,
        select: {
          packageNameSnapshot: true,
          validUntil: true,
          customer: {
            select: { customerCode: true, name: true },
          },
        },
        orderBy: { validUntil: "asc" },
        take: MAX_PACKAGES,
      }),
      prisma.customerPackage.count({ where }),
    ]);

    return {
      summary: `${total} customer package${
        total === 1 ? "" : "s"
      } expire${total === 1 ? "s" : ""} in the next ${EXPIRY_WINDOW_DAYS} days.`,
      data: {
        total,
        windowDays: EXPIRY_WINDOW_DAYS,
        packages,
        truncated: total > packages.length,
      },
    };
  },
};
