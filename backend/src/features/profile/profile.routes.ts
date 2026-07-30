import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import {
  getBranchProfile,
  getGstProfile,
  getProfile,
  getSalonProfile,
  updateBranchProfile,
  updateGstProfile,
  updateProfile,
  updateSalonProfile,
} from "./profile.controller.js";

const router = Router();

router.get("/profile", authenticate, getProfile);
router.put("/profile", authenticate, updateProfile);
router.get("/salon-profile", authenticate, getSalonProfile);
router.put("/salon-profile", authenticate, updateSalonProfile);
router.get("/branch-profile", authenticate, getBranchProfile);
router.put("/branch-profile", authenticate, updateBranchProfile);
router.get("/salon-profile/gst", authenticate, getGstProfile);
router.put("/salon-profile/gst", authenticate, updateGstProfile);

export default router;
