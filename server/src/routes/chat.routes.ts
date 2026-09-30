import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { streamChat } from "../controllers/chat.controller.js";

export const chatRouter = Router();

chatRouter.post("/stream", requireAuth, streamChat);
