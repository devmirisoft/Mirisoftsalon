import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/rbac.middleware.js";
import {
  createProduct,
  deleteProduct,
  getLowStockProducts,
  getProduct,
  getProductActivityHandler,
  getProducts,
  setProductStatus,
  updateProduct,
} from "./product.controller.js";

import { validateUuidParam } from "../../middlewares/uuid.middleware.js";

const router = Router();
router.param("id", validateUuidParam("id"));
router.use(authenticate);
router.post("/", requireRole("SUPER_ADMIN", "SALON_ADMIN"), createProduct);
router.get("/", requireRole("SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST", "STAFF"), getProducts);
router.get("/low-stock", requireRole("SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST", "STAFF"), getLowStockProducts);
router.patch("/:id/status", requireRole("SUPER_ADMIN", "SALON_ADMIN"), setProductStatus);
router.get("/:id/activity", requireRole("SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST", "STAFF"), getProductActivityHandler);
router.get("/:id", requireRole("SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST", "STAFF"), getProduct);
router.put("/:id", requireRole("SUPER_ADMIN", "SALON_ADMIN"), updateProduct);
router.delete("/:id", requireRole("SUPER_ADMIN", "SALON_ADMIN"), deleteProduct);
export default router;
