import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import {register, login, me, refresh, logout} from "./auth.controller.js"
import { loginRateLimiter } from "../../middlewares/rate-limit.middleware.js";

const router = Router();


router.post("/register", loginRateLimiter, register);
router.post("/login", loginRateLimiter, login);
router.post("/refresh", refresh);
router.post("/logout", logout);

router.use(authenticate);

router.get("/me", me);



export default router;
