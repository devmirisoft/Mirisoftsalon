import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { chat, chatStream } from "./ai-assistant.controller.js";

const router = Router();

router.post("/chat", authenticate, chat);
router.post("/chat/stream", authenticate, chatStream);

export default router;
