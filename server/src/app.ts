import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { authRouter } from "./routes/auth.routes.js";
import { documentRouter } from "./routes/document.routes.js";
import { chatRouter } from "./routes/chat.routes.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { embeddings } from "./services/embeddings/index.js";
import { chat } from "./services/llm/index.js";

export function createApp(): express.Express {
  const app = express();

  // Trust the first proxy hop so req.ip is correct behind a load balancer.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
    }),
  );

  // Chat streaming needs the raw body only for JSON payloads; the 1mb limit is
  // ample because document content travels as multipart, not JSON.
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      uptimeSeconds: Math.round(process.uptime()),
      embeddings: {
        provider: embeddings.name,
        dimensions: embeddings.dimensions,
      },
      chat: {
        provider: chat.name,
        available: chat.isAvailable(),
      },
      chunking: {
        size: env.CHUNK_SIZE,
        overlap: env.CHUNK_OVERLAP,
      },
    });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/documents", documentRouter);
  app.use("/api/chat", chatRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
