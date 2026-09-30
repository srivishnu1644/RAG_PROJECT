import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { connectDatabase, disconnectDatabase } from "./db/connect.js";
import { embeddings } from "./services/embeddings/index.js";
import { chat } from "./services/llm/index.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  await connectDatabase();

  // Preload the embedding model. Doing this at boot means the first upload is
  // not delayed by a cold ONNX load (and the ~90MB download happens once, up
  // front, where the user can see it in the logs).
  if ("warmUp" in embeddings && typeof embeddings.warmUp === "function") {
    await embeddings.warmUp();
  }

  if (!chat.isAvailable()) {
    logger.warn(
      "No GEMINI_API_KEY configured. Uploads and indexing will work, but chat will return 502.",
    );
  }

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info(
      `API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`,
    );
  });

  // SSE connections are long-lived; the default 5s headers timeout would be
  // fine but the request timeout must not cut a stream short.
  server.requestTimeout = 0;
  server.headersTimeout = 0;

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received, shutting down.`);
    server.close();
    await disconnectDatabase();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  logger.error("Fatal startup error", error);
  process.exit(1);
});
