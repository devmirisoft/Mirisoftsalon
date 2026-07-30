import { prisma } from "../../../config/prisma.js";
import type { AiTool } from "../ai-tool.types.js";
import { aiSharedBranchScope } from "../ai-permission.service.js";

const MAX_RETURNED_PRODUCTS = 10;
const MAX_SCANNED_PRODUCTS = 50;

export const getLowStockProductsTool: AiTool = {
  name: "getLowStockProducts",
  description: "Returns products at or below their low-stock threshold.",
  allowedRoles: ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER"],

  async run({ context }) {
    const products = await prisma.product.findMany({
      where: {
        ...(context.salonId ? { salonId: context.salonId } : {}),
        ...aiSharedBranchScope(context),
        status: true,
        lowStockAlert: { gt: 0 },
      },
      select: {
        name: true,
        sku: true,
        unit: true,
        branchId: true,
        currentStock: true,
        lowStockAlert: true,
      },
      orderBy: { name: "asc" },
      take: MAX_SCANNED_PRODUCTS,
    });

    const lowStock = products.filter(
      (product) =>
        Number(product.currentStock) <= Number(product.lowStockAlert)
    );
    const ranked = lowStock
      .map((product) => {
        const currentStock = Number(product.currentStock);
        const lowStockAlert = Number(product.lowStockAlert);
        return {
          ...product,
          currentStock,
          lowStockAlert,
          shortage: Math.max(0, lowStockAlert - currentStock),
        };
      })
      .sort((a, b) => b.shortage - a.shortage || a.name.localeCompare(b.name));
    const mostUrgent = ranked[0];

    return {
      summary: `${lowStock.length} product${
        lowStock.length === 1 ? " is" : "s are"
      } low on stock.`,
      data: {
        total: lowStock.length,
        products: ranked.slice(0, MAX_RETURNED_PRODUCTS),
        truncated: lowStock.length > MAX_RETURNED_PRODUCTS,
      },
      cards: [
        {
          type: lowStock.length ? "WARNING" : "METRIC",
          title: "Low stock",
          value: String(lowStock.length),
          description: mostUrgent
            ? `${mostUrgent.name} has the largest shortage.`
            : "No low-stock products found.",
        },
      ],
      table: {
        columns: [
          { key: "name", label: "Product" },
          { key: "currentStock", label: "Stock" },
          { key: "lowStockAlert", label: "Min" },
          { key: "shortage", label: "Shortage" },
        ],
        rows: ranked.slice(0, MAX_RETURNED_PRODUCTS).map((product) => ({
          name: product.name,
          sku: product.sku,
          unit: product.unit,
          currentStock: product.currentStock,
          lowStockAlert: product.lowStockAlert,
          shortage: product.shortage,
        })),
      },
      suggestedActions: [
        {
          id: "open-low-stock",
          label: "Open low stock",
          actionType: "NAVIGATE",
          requiresConfirmation: false,
          payload: { route: "/admin/low-stock" },
        },
      ],
      warnings:
        ranked.length > 0
          ? [`Order ${mostUrgent?.name ?? "the most short product"} first based on stock shortage.`]
          : undefined,
    };
  },
};
