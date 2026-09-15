import type { Role } from "../generated/prisma/enums.js";

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        role: Role | string;
        salonId?: string;
        branchId?: string;
        /**
         * Branch a salon-wide role has opened a session on (X-Branch-Id).
         * Absent means "all branches", which is the default for admins.
         */
        activeBranchId?: string;
      };
    }
  }
}

export {};
