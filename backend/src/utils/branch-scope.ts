import { type Request } from "express";

/**
 * Roles that are confined to a single branch. Their requests may only read and
 * write rows belonging to the branch stored on their user record, and any
 * caller-supplied branchId is ignored rather than trusted.
 */
const BRANCH_LOCKED_ROLES = new Set([
  "BRANCH_MANAGER",
  "RECEPTIONIST",
  "STAFF",
]);

/** Roles allowed to work across every branch of their salon. */
const BRANCH_UNRESTRICTED_ROLES = new Set(["SUPER_ADMIN", "SALON_ADMIN"]);

export const isBranchLockedRole = (role?: string) =>
  typeof role === "string" && BRANCH_LOCKED_ROLES.has(role);

export const isBranchUnrestrictedRole = (role?: string) =>
  typeof role === "string" && BRANCH_UNRESTRICTED_ROLES.has(role);

/**
 * The branch a request is confined to.
 *
 * Returns `undefined` for SUPER_ADMIN and SALON_ADMIN, which preserves the
 * existing all-branches behaviour for admins. Branch-locked roles always
 * resolve to their own branch.
 *
 * `authenticate` rejects branch-locked users without a branchId, so a
 * branch-locked role reaching a controller always has one. The `null` return
 * is a defensive stop: it means "locked but unresolvable", and callers must
 * treat it as a failure rather than as "no filter", otherwise a missing branch
 * would silently widen access to the whole salon.
 */
export const resolveBranchScope = (req: Request): string | undefined | null => {
  const role = req.user?.role;

  if (isBranchUnrestrictedRole(role)) {
    return undefined;
  }

  if (isBranchLockedRole(role)) {
    return req.user?.branchId ?? null;
  }

  return req.user?.branchId ?? null;
};

/**
 * Resolves the branch to persist on a newly created row.
 *
 * Branch-locked callers always get their own branch and any `requestedBranchId`
 * from the request body is discarded — validating a supplied value would still
 * let a manager place records in another branch. Admins keep the current
 * behaviour of choosing a branch explicitly.
 */
export const resolveWritableBranchId = (
  req: Request,
  requestedBranchId?: unknown
): { ok: true; branchId?: string } | { ok: false; message: string } => {
  if (isBranchLockedRole(req.user?.role)) {
    const branchId = req.user?.branchId;

    if (!branchId) {
      return {
        ok: false,
        message: "Your account is not assigned to a branch",
      };
    }

    return { ok: true, branchId };
  }

  if (requestedBranchId === undefined || requestedBranchId === null) {
    return { ok: true };
  }

  if (typeof requestedBranchId !== "string" || !requestedBranchId) {
    return { ok: false, message: "Invalid branchId" };
  }

  return { ok: true, branchId: requestedBranchId };
};

/**
 * Guards a caller-supplied branch filter (typically `?branchId=`) against the
 * request's scope, so a branch-locked user cannot read another branch by
 * passing its id.
 */
export const resolveBranchFilter = (
  req: Request,
  requestedBranchId?: unknown
): { ok: true; branchId?: string } | { ok: false; message: string } => {
  const scope = resolveBranchScope(req);

  if (scope === null) {
    return { ok: false, message: "Your account is not assigned to a branch" };
  }

  const requested =
    typeof requestedBranchId === "string" && requestedBranchId
      ? requestedBranchId
      : undefined;

  if (scope) {
    if (requested && requested !== scope) {
      return { ok: false, message: "You do not have access to this branch" };
    }

    return { ok: true, branchId: scope };
  }

  return { ok: true, ...(requested ? { branchId: requested } : {}) };
};

/**
 * Confirms a row the caller is about to read, update or delete belongs to the
 * request's branch. Rows with a null branchId are salon-wide and stay visible.
 */
export const isBranchAccessible = (
  req: Request,
  rowBranchId?: string | null
) => {
  const scope = resolveBranchScope(req);

  if (scope === null) return false;
  if (scope === undefined) return true;
  if (rowBranchId === null || rowBranchId === undefined) return true;

  return rowBranchId === scope;
};
