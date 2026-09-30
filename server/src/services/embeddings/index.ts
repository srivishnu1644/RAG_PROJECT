import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { LocalEmbeddingProvider } from "./local.provider.js";
import { GeminiEmbeddingProvider } from "./gemini.provider.js";
import type { EmbeddingProvider } from "./types.js";

export type { EmbeddingProvider };
export { assertVectorShape, normalizeVector } from "./types.js";
export { LocalEmbeddingProvider } from "./local.provider.js";
export { GeminiEmbeddingProvider } from "./gemini.provider.js";

/**
 * Single source of truth for which embedder the app uses. Resolved once at
 * import time so request handling never branches on env.
 */
function createEmbeddingProvider(): EmbeddingProvider {
  if (env.EMBEDDING_PROVIDER === "gemini") {
    logger.info(
      `Embedding provider: gemini (${env.EMBEDDING_DIMENSIONS} dims)`,
    );
    return new GeminiEmbeddingProvider();
  }

  logger.info(
    `Embedding provider: local (${env.EMBEDDING_MODEL}, ${env.EMBEDDING_DIMENSIONS} dims)`,
  );
  return new LocalEmbeddingProvider(env.EMBEDDING_DIMENSIONS);
}

export const embeddings: EmbeddingProvider = createEmbeddingProvider();
