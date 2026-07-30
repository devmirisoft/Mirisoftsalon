import type { SalonAiSuggestedAction } from "./ai-tool.types.js";

const ROUTES_BY_ENTITY: Record<string, string> = {
  APPOINTMENT: "/appointments",
  CUSTOMER: "/customers",
  INVOICE: "/billing/invoices/:id",
  PRODUCT: "/admin/products",
  STAFF: "/reports/staff-performance",
  MEMBERSHIP: "/customer-retention/memberships",
  PACKAGE: "/packages",
  PAYMENT: "/billing",
};

const NAVIGATION_ROUTES = new Set([
  "/",
  "/appointments",
  "/customers",
  "/billing",
  "/admin/low-stock",
  "/admin/products",
  "/reports/staff-performance",
  "/customer-retention/memberships",
  "/packages",
]);

const safeId = (value: unknown) =>
  typeof value === "string" && value.length > 0 && value.length <= 100;

export function validateSuggestedAction(
  action: SalonAiSuggestedAction
): SalonAiSuggestedAction | null {
  if (!action.id || !action.label || !action.actionType) return null;

  if (action.actionType === "NAVIGATE") {
    const route = action.payload.route;
    if (typeof route !== "string" || !NAVIGATION_ROUTES.has(route)) {
      return null;
    }
    return {
      ...action,
      requiresConfirmation: Boolean(action.requiresConfirmation),
      payload: { route },
    };
  }

  if (action.actionType === "OPEN_ENTITY") {
    const entityType = action.payload.entityType;
    const entityId = action.payload.entityId;
    if (
      typeof entityType !== "string" ||
      !ROUTES_BY_ENTITY[entityType] ||
      !safeId(entityId)
    ) {
      return null;
    }
    return {
      ...action,
      requiresConfirmation: false,
      payload: { entityType, entityId },
    };
  }

  if (action.actionType === "PREVIEW_MESSAGE") {
    const customerIds = action.payload.customerIds;
    if (
      !Array.isArray(customerIds) ||
      customerIds.length > 25 ||
      !customerIds.every(safeId)
    ) {
      return null;
    }
    return {
      ...action,
      requiresConfirmation: Boolean(action.requiresConfirmation),
      payload: { customerIds },
    };
  }

  if (
    action.actionType === "PREFILL_FORM" ||
    action.actionType === "RUN_FOLLOW_UP"
  ) {
    return {
      ...action,
      requiresConfirmation: Boolean(action.requiresConfirmation),
      payload: action.payload,
    };
  }

  return null;
}

export function validateSuggestedActions(
  actions: SalonAiSuggestedAction[] | undefined
) {
  return (actions ?? [])
    .map(validateSuggestedAction)
    .filter((action): action is SalonAiSuggestedAction => Boolean(action))
    .slice(0, 5);
}
