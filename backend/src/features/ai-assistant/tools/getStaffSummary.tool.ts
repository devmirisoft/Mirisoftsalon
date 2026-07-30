import { prisma } from "../../../config/prisma.js";
import type { AiTool } from "../ai-tool.types.js";
import { aiExactBranchScope } from "../ai-permission.service.js";

export const getStaffSummaryTool: AiTool = {
  name: "getStaffSummary",
  description: "Returns a scoped staff count and status summary.",
  allowedRoles: ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST"],

  async run({ context }) {
    const where = {
      ...aiExactBranchScope(context),
    };
    const [total, active, inactive, byRole] = await Promise.all([
      prisma.staff.count({ where }),
      prisma.staff.count({ where: { ...where, status: true } }),
      prisma.staff.count({ where: { ...where, status: false } }),
      prisma.staff.groupBy({
        by: ["jobRole"],
        where,
        _count: { id: true },
        orderBy: { jobRole: "asc" },
      }),
    ]);

    return {
      summary: `You have ${total} staff member${
        total === 1 ? "" : "s"
      }: ${active} active and ${inactive} inactive.`,
      data: {
        total,
        active,
        inactive,
        byRole: byRole.map((row) => ({
          role: row.jobRole,
          count: row._count.id,
        })),
      },
      cards: [
        {
          type: "METRIC",
          title: "Staff",
          value: String(total),
          description: `${active} active, ${inactive} inactive`,
        },
      ],
      table: {
        columns: [
          { key: "role", label: "Role" },
          { key: "count", label: "Staff" },
        ],
        rows: byRole.map((row) => ({
          role: row.jobRole,
          count: row._count.id,
        })),
      },
    };
  },
};
