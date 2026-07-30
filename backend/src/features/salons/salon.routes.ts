import { Router } from "express";
import {
  createSalon,
  getSalonGstSettings,
  getSalons,
  updateSalonGstSettings,
} from "./salon.controller.js";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/rbac.middleware.js";

const router = Router();

router.use(authenticate);

router.post("/", requireRole("SUPER_ADMIN"), createSalon);
router.get("/", requireRole("SUPER_ADMIN"), getSalons);
router.get("/gst/settings", requireRole("SALON_ADMIN", "SUPER_ADMIN"), getSalonGstSettings);
router.patch("/gst/settings", requireRole("SALON_ADMIN", "SUPER_ADMIN"), updateSalonGstSettings);
router.get("/:id/gst/settings", requireRole("SUPER_ADMIN"), getSalonGstSettings);
router.patch("/:id/gst/settings", requireRole("SUPER_ADMIN"), updateSalonGstSettings);

export default router;
