import { prisma } from "../../../config/prisma.js";
import type { AiTool } from "../ai-tool.types.js";
import { aiExactBranchScope } from "../ai-permission.service.js";

const EXPIRY_WINDOW_DAYS = 30;
const MAX_MEMBERSHIPS = 10;

export const getMembershipExpirySummaryTool: AiTool = {
  name: "getMembershipExpirySummary",
  description: "Returns customer memberships expiring in the next 30 days.",
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
      expiresAt: { gte: now, lte: cutoff },
    };
    const [memberships, total] = await Promise.all([
      prisma.customerMembership.findMany({
        where,
        select: {
          membershipNameSnapshot: true,
          expiresAt: true,
          customer: {
            select: { customerCode: true, name: true },
          },
        },
        orderBy: { expiresAt: "asc" },
        take: MAX_MEMBERSHIPS,
      }),
      prisma.customerMembership.count({ where }),
    ]);

    return {
      summary: `${total} customer membership${
        total === 1 ? "" : "s"
      } expire${total === 1 ? "s" : ""} in the next ${EXPIRY_WINDOW_DAYS} days.`,
      data: {
        total,
        windowDays: EXPIRY_WINDOW_DAYS,
        memberships,
        truncated: total > memberships.length,
      },
    };
  },
};
