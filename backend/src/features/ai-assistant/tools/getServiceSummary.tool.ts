import { prisma } from "../../../config/prisma.js";
import type { AiTool } from "../ai-tool.types.js";
import { aiSharedBranchScope } from "../ai-permission.service.js";

export const getServiceSummaryTool: AiTool = {
  name: "getServiceSummary",
  description: "Returns scoped salon service counts, active status, categories, and price range.",
  allowedRoles: [
    "SUPER_ADMIN",
    "SALON_ADMIN",
    "BRANCH_MANAGER",
    "RECEPTIONIST",
    "STAFF",
  ],

  async run({ context }) {
    const where = {
      ...aiSharedBranchScope(context),
    };
    const [total, active, inactive, services, priceAggregate] =
      await Promise.all([
        prisma.service.count({ where }),
        prisma.service.count({ where: { ...where, status: true } }),
        prisma.service.count({ where: { ...where, status: false } }),
        prisma.service.findMany({
          where,
          select: {
            name: true,
            status: true,
            price: true,
            durationValue: true,
            durationUnit: true,
            mainService: { select: { name: true } },
          },
          orderBy: [{ mainService: { name: "asc" } }, { name: "asc" }],
          take: 20,
        }),
        prisma.service.aggregate({
          where,
          _min: { price: true },
          _max: { price: true },
        }),
      ]);
    const byCategory = services.reduce<Record<string, number>>((acc, service) => {
      const category = service.mainService.name;
      acc[category] = (acc[category] ?? 0) + 1;
      return acc;
    }, {});

    return {
      summary: `You have ${total} service${total === 1 ? "" : "s"}: ${active} active and ${inactive} inactive.`,
      data: {
        total,
        active,
        inactive,
        priceRange: {
          min: Number(priceAggregate._min.price ?? 0),
          max: Number(priceAggregate._max.price ?? 0),
        },
        byCategory,
        services: services.map((service) => ({
          name: service.name,
          category: service.mainService.name,
          status: service.status ? "ACTIVE" : "INACTIVE",
          price: Number(service.price),
          duration: service.durationValue
            ? `${service.durationValue} ${service.durationUnit}`
            : null,
        })),
        truncated: total > services.length,
      },
      cards: [
        {
          type: "METRIC",
          title: "Services",
          value: String(total),
          description: `${active} active, ${inactive} inactive`,
        },
      ],
      table: {
        columns: [
          { key: "category", label: "Category" },
          { key: "count", label: "Services" },
        ],
        rows: Object.entries(byCategory).map(([category, count]) => ({
          category,
          count,
        })),
      },
    };
  },
};
