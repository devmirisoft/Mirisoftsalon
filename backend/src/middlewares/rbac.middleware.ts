import { type Request, type Response, type NextFunction } from "express";

const check = (
  allowed: (role: string) => boolean
) => (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized",
    });
  }

  if (!allowed(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: "Forbidden",
    });
  }

  next();
};

/**
 * A branch manager is a salon admin confined to one branch, so it inherits
 * every SALON_ADMIN grant. The branch limit is enforced separately by the
 * helpers in utils/branch-scope.ts, which filter the manager's reads and pin
 * their writes to their own branch.
 *
 * Salon-wide actions a manager must not perform (creating branches, salon GST,
 * provisioning admins and other managers) are guarded with requireExactRole.
 */
export const requireRole = (...roles: string[]) =>
  check(
    (role) =>
      roles.includes(role) ||
      (role === "BRANCH_MANAGER" && roles.includes("SALON_ADMIN"))
  );

/** Like requireRole, but without the branch-manager inheritance. */
export const requireExactRole = (...roles: string[]) =>
  check((role) => roles.includes(role));
