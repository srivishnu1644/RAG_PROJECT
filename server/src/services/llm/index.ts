import { logger } from "../../utils/logger.js";
import { GeminiChatProvider, GEMINI_KEY_SHAPE } from "./gemini.provider.js";
import type { ChatProvider } from "./types.js";

export type { ChatMessage, ChatProvider } from "./types.js";
export { GeminiChatProvider } from "./gemini.provider.js";

/**
 * Resolved once. Adding OpenAI or Ollama later means adding a branch here and
 * nothing else — every call site talks to the ChatProvider interface.
 */
function createChatProvider(): ChatProvider {
  const provider = new GeminiChatProvider();

  if (provider.isAvailable()) {
    const key = process.env["GEMINI_API_KEY"] ?? "";
    if (!GEMINI_KEY_SHAPE.test(key)) {
      // A warning, not a hard failure: newer key formats exist and work.
      // This catches the common case of a key clipped while copying, which
      // otherwise looks fine until a user sends their first message.
      logger.warn(
        `GEMINI_API_KEY does not match the usual AIza… shape (${key.length} chars). ` +
          "If chat fails with an invalid-key error, re-copy the full key.",
      );
    }
  }

  logger.info(
    `Chat provider: ${provider.name} (${provider.isAvailable() ? "ready" : "no API key"})`,
  );
  return provider;
}

export const chat: ChatProvider = createChatProvider();
