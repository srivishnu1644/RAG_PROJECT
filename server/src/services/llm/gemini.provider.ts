import { GoogleGenAI, type Content } from "@google/genai";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { ApiError } from "../../utils/ApiError.js";
import type { ChatMessage, ChatProvider } from "./types.js";

/** `AIza` + 35 chars is the classic Gemini key shape. */
export const GEMINI_KEY_SHAPE = /^AIza[\w-]{35}$/;

/**
 * Turns Gemini's nested error blobs into something a human can act on.
 *
 * The raw `error.message` is a JSON string containing more JSON, which is why
 * these failures used to reach the user as an unreadable wall of escaped text.
 * The three that actually happen in practice — a retired model name, a
 * truncated key, and a capacity spike — each have a specific fix worth naming.
 */
function translateGeminiError(error: unknown, model: string): ApiError {
  const raw = error instanceof Error ? error.message : String(error);

  if (/API_KEY_INVALID|API key not valid/i.test(raw)) {
    return ApiError.llmUnavailable(
      "GEMINI_API_KEY was rejected by Google. Re-copy the full key from " +
        "https://aistudio.google.com/apikey — a partially pasted key looks " +
        "valid locally but fails here.",
    );
  }

  if (
    /is no longer available to new users|is not found for API version/i.test(
      raw,
    )
  ) {
    return ApiError.llmUnavailable(
      `CHAT_MODEL "${model}" is retired or not available for this key. Set ` +
        "CHAT_MODEL in backend/.env to a current model, e.g. gemini-3.8-flash.",
    );
  }

  if (/high demand|UNAVAILABLE/i.test(raw)) {
    return ApiError.llmUnavailable(
      `${model} is temporarily overloaded. Retry in a moment, or point ` +
        "CHAT_MODEL at a more widely used model.",
    );
  }

  return ApiError.llmUnavailable(raw);
}

/**
 * Gemini chat with token streaming.
 *
 * Streaming matters here for UX, not just throughput: the user sees the answer
 * appear progressively instead of waiting for the full completion.
 */
export class GeminiChatProvider implements ChatProvider {
  readonly name = "gemini";

  private client: GoogleGenAI | null = null;

  /**
   * True when a key is present.
   *
   * Deliberately NOT a shape check. `Boolean(GEMINI_API_KEY)` reported a
   * truncated key as usable, which stayed invisible until a user asked a
   * question — so startup now logs a warning for keys that do not match the
   * classic `AIza…` shape. But newer key formats exist and they work, so
   * guessing "malformed" from a length check would reject valid keys. Only
   * Google's own 400 tells the truth, and that surfaces at call time.
   */
  isAvailable(): boolean {
    return Boolean(env.GEMINI_API_KEY);
  }

  private getClient(): GoogleGenAI {
    if (!env.GEMINI_API_KEY) {
      throw ApiError.llmUnavailable(
        "GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey",
      );
    }
    this.client ??= new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    return this.client;
  }

  /**
   * Gemini takes system instructions out-of-band rather than as a message with
   * role 'system', so we split them here.
   */
  private toContents(messages: ChatMessage[]): {
    systemInstruction: string | undefined;
    contents: Content[];
  } {
    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");

    const contents: Content[] = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      }));

    return { systemInstruction: system || undefined, contents };
  }

  async *stream(
    messages: ChatMessage[],
    signal: AbortSignal,
  ): AsyncGenerator<string, void, undefined> {
    const client = this.getClient();
    const { systemInstruction, contents } = this.toContents(messages);

    try {
      const stream = await client.models.generateContentStream({
        model: env.CHAT_MODEL,
        contents,
        config: {
          ...(systemInstruction ? { systemInstruction } : {}),
          temperature: 0.2,
          maxOutputTokens: 2048,
          abortSignal: signal,
        },
      });

      for await (const chunk of stream) {
        if (signal.aborted) return;

        // Gemini splits output across parts; only some carry text.
        const text = chunk.text;
        if (text) yield text;
      }
    } catch (error) {
      // A client-initiated abort is normal operation, not a failure worth
      // surfacing to the user as an error.
      if (signal.aborted) return;

      logger.error("Gemini streaming failed", error);
      throw translateGeminiError(error, env.CHAT_MODEL);
    }
  }
}
