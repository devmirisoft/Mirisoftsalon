import type { AiRole, AiTool, AiToolContext } from "./ai-tool.types.js";

const BRANCH_SCOPED_ROLES = new Set<AiRole>([
  "BRANCH_MANAGER",
  "RECEPTIONIST",
  "STAFF",
]);

const unauthorizedScope = (context: AiToolContext) => ({
  salonId: context.salonId ?? "__unauthorized__",
  branchId: "__unauthorized__",
});

export function canUseAiTool(role: AiRole, tool: AiTool): boolean {
  return tool.allowedRoles.includes(role);
}

export function aiSalonScope(context: AiToolContext) {
  return context.salonId
    ? { salonId: context.salonId }
    : { salonId: "__unauthorized__" };
}

export function aiExactBranchScope(context: AiToolContext) {
  if (context.role === "SUPER_ADMIN") {
    return {
      ...aiSalonScope(context),
      ...(context.branchId ? { branchId: context.branchId } : {}),
    };
  }

  if (context.role === "SALON_ADMIN") {
    return {
      ...aiSalonScope(context),
      ...(context.branchId ? { branchId: context.branchId } : {}),
    };
  }

  if (!context.salonId || !context.branchId) {
    return unauthorizedScope(context);
  }

  return {
    salonId: context.salonId,
    branchId: context.branchId,
  };
}

export function aiSharedBranchScope(context: AiToolContext) {
  if (context.role === "SUPER_ADMIN") {
    return {
      ...aiSalonScope(context),
      ...(context.branchId
        ? { OR: [{ branchId: null }, { branchId: context.branchId }] }
        : {}),
    };
  }

  if (context.role === "SALON_ADMIN") {
    return aiSalonScope(context);
  }

  if (!context.salonId || !context.branchId) {
    return unauthorizedScope(context);
  }

  return {
    salonId: context.salonId,
    OR: [{ branchId: null }, { branchId: context.branchId }],
  };
}
