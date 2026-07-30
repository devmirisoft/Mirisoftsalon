import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/rbac.middleware.js";
import { validateUuidParam } from "../../middlewares/uuid.middleware.js";
import {
  getCustomerPackageById,
  getCustomerPackageBalancesByCustomer,
  getCustomerPackageBalancesById,
  getCustomerPackageUsageHistory,
  getCustomerPackages,
  getCustomerPackagesForCustomer,
  getCustomerCustomPackages,
  getPackageById,
  getPackageCategories,
  getPackageCategoryById,
  getPackages,
  patchCustomerPackageStatus,
  patchPackageCategoryStatus,
  patchPackageStatus,
  postCopyCustomerCustomPackage,
  postCustomPackageFromCart,
  postPackage,
  postPackageCategory,
  putPackage,
  putPackageCategory,
  removePackage,
  removePackageCategory,
} from "./package.controller.js";

const viewers = [
  "SUPER_ADMIN",
  "SALON_ADMIN",
  "BRANCH_MANAGER",
  "RECEPTIONIST",
] as const;
const managers = ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER"] as const;

export const packageCategoryRoutes = Router();
packageCategoryRoutes.param("id", validateUuidParam("id"));
packageCategoryRoutes.use(authenticate);
packageCategoryRoutes.get("/", requireRole(...viewers), getPackageCategories);
packageCategoryRoutes.post("/", requireRole(...managers), postPackageCategory);
packageCategoryRoutes.get(
  "/:id",
  requireRole(...viewers),
  getPackageCategoryById
);
packageCategoryRoutes.put(
  "/:id",
  requireRole(...managers),
  putPackageCategory
);
packageCategoryRoutes.patch(
  "/:id/status",
  requireRole(...managers),
  patchPackageCategoryStatus
);
packageCategoryRoutes.delete(
  "/:id",
  requireRole(...managers),
  removePackageCategory
);

export const servicePackageRoutes = Router();
servicePackageRoutes.param("id", validateUuidParam("id"));
servicePackageRoutes.use(authenticate);
servicePackageRoutes.get("/", requireRole(...viewers), getPackages);
servicePackageRoutes.get(
  "/customer-custom",
  requireRole(...viewers),
  getCustomerCustomPackages
);
servicePackageRoutes.post(
  "/custom/from-cart",
  requireRole(...managers),
  postCustomPackageFromCart
);
servicePackageRoutes.post(
  "/custom/copy",
  requireRole(...managers),
  postCopyCustomerCustomPackage
);
servicePackageRoutes.post("/", requireRole(...managers), postPackage);
servicePackageRoutes.get("/:id", requireRole(...viewers), getPackageById);
servicePackageRoutes.put("/:id", requireRole(...managers), putPackage);
servicePackageRoutes.patch(
  "/:id/status",
  requireRole(...managers),
  patchPackageStatus
);
servicePackageRoutes.delete("/:id", requireRole(...managers), removePackage);

export const customerPackageRoutes = Router();
customerPackageRoutes.param("id", validateUuidParam("id"));
customerPackageRoutes.use(authenticate);
customerPackageRoutes.get("/", requireRole(...viewers), getCustomerPackages);
customerPackageRoutes.get(
  "/:id/balances",
  requireRole(...viewers),
  getCustomerPackageBalancesById
);
customerPackageRoutes.get(
  "/:id/usages",
  requireRole(...viewers),
  getCustomerPackageUsageHistory
);
customerPackageRoutes.get(
  "/:id",
  requireRole(...viewers),
  getCustomerPackageById
);
customerPackageRoutes.patch(
  "/:id/status",
  requireRole(...managers),
  patchCustomerPackageStatus
);

export const customerPackageCustomerRoutes = Router();
customerPackageCustomerRoutes.param(
  "customerId",
  validateUuidParam("customerId")
);
customerPackageCustomerRoutes.use(authenticate);
customerPackageCustomerRoutes.get(
  "/:customerId/package-balances",
  requireRole(...viewers),
  getCustomerPackageBalancesByCustomer
);
customerPackageCustomerRoutes.get(
  "/:customerId/packages",
  requireRole(...viewers),
  getCustomerPackagesForCustomer
);
