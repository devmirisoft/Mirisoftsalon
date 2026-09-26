import { prisma } from "../../../config/prisma.js";
import type { AiTool } from "../ai-tool.types.js";
import { aiSharedBranchScope } from "../ai-permission.service.js";

const MAX_RETURNED_PRODUCTS = 50;

export const getProductSummaryTool: AiTool = {
  name: "getProductSummary",
  description: "Returns the scoped product list with category, selling price, stock and active status.",
  allowedRoles: ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST"],

  async run({ context }) {
    const where = aiSharedBranchScope(context);
    const [total, active, products] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.count({ where: { ...where, status: true } }),
      prisma.product.findMany({
        where,
        select: {
          name: true,
          sku: true,
          category: true,
          unit: true,
          sellingPrice: true,
          currentStock: true,
          status: true,
          brand: { select: { name: true } },
        },
        orderBy: { name: "asc" },
        take: MAX_RETURNED_PRODUCTS,
      }),
    ]);
    const rows = products.map((product) => ({
      name: product.name,
      sku: product.sku,
      brand: product.brand?.name ?? null,
      category: product.category ?? "Uncategorized",
      sellingPrice: Number(product.sellingPrice),
      stock: `${Number(product.currentStock)} ${product.unit}`,
      status: product.status ? "ACTIVE" : "INACTIVE",
    }));

    return {
      summary: `You have ${total} product${total === 1 ? "" : "s"}: ${active} active and ${total - active} inactive.`,
      data: {
        total,
        active,
        inactive: total - active,
        products: rows,
        truncated: total > rows.length,
      },
      cards: [
        {
          type: "METRIC",
          title: "Products",
          value: String(total),
          description: `${active} active, ${total - active} inactive`,
        },
      ],
      table: {
        columns: [
          { key: "name", label: "Product" },
          { key: "category", label: "Category" },
          { key: "sellingPrice", label: "Price" },
          { key: "stock", label: "Stock" },
        ],
        rows,
      },
      warnings:
        total > rows.length
          ? [`Showing the first ${rows.length} of ${total} products.`]
          : undefined,
    };
  },
};
