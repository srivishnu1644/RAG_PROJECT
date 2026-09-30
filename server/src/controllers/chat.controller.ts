import type { Request, Response } from "express";
import { z } from "zod";
import { currentUser } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";
import { ApiError } from "../utils/ApiError.js";
import {
  searchRelevantChunks,
  type RetrievedChunk,
} from "../services/vectorSearch.js";
import { chat, type ChatMessage } from "../services/llm/index.js";

const requestSchema = z.object({
  message: z.string().min(1, "Message cannot be empty.").max(4000),
  documentIds: z.array(z.string()).optional(),
});

/**
 * Builds the grounded system prompt.
 *
 * The instruction to answer ONLY from context is what makes this retrieval-
 * augmented rather than just "chat with extra text nearby". It is the single
 * most important line for answer quality and for avoiding hallucination.
 */
function buildSystemPrompt(chunks: RetrievedChunk[]): string {
  const context = chunks
    .map(
      (chunk, index) =>
        `[Source ${index + 1}] (file: ${chunk.filename}, chunk ${chunk.chunkIndex}, relevance ${chunk.score.toFixed(2)})\n${chunk.text}`,
    )
    .join("\n\n---\n\n");

  return [
    "You are a document intelligence assistant. You answer questions using ONLY the",
    "context excerpts supplied below, which were retrieved from the user's own files.",
    "",
    "Rules:",
    "- Base every claim strictly on the provided context. Never use outside knowledge.",
    "- If the context does not contain the answer, say so plainly and suggest what would help.",
    "- Do not invent sources, quotes, page numbers, or file names.",
    "- When you use a source, cite it inline using its bracketed number, e.g. [1] or [2][3].",
    "- Use every passage that is genuinely relevant. Do not pad the answer with",
    "  passages that do not bear on the question.",
    "- When the context is thin or ambiguous, say what is missing and ask one",
    "  specific clarifying question rather than guessing.",
    "- Be concise and well organised. Use short paragraphs or bullet lists where helpful.",
    "",
    "=== CONTEXT ===",
    context,
    "=== END CONTEXT ===",
  ].join("\n");
}

/**
 * Advice shown when retrieval found nothing usable.
 *
 * The two cases need different wording. `allBelowThreshold` means the index
 * HAS chunks but none of them resemble the question — usually a wording
 * mismatch, so asking for a rephrase is useful. An empty result set means the
 * library genuinely has nothing, and no amount of rephrasing will help, so
 * asking for a rephrase there would be misleading.
 */
function noContextMessage(
  query: string,
  scopedToSelection: boolean,
  allBelowThreshold: boolean,
): string {
  if (scopedToSelection) {
    return allBelowThreshold
      ? "None of your selected documents cover this. Try clearing the document filter to search your whole library, or rephrase the question."
      : "Your selected documents do not contain anything on this. Try selecting different documents, or rephrase the question.";
  }

  if (allBelowThreshold) {
    return "I could not find anything in your documents that matches this question. Try rephrasing it with different wording, or add more detail about what you are looking for.";
  }

  return "I could not find anything relevant in your library. Try uploading a document that covers this topic, or rephrase the question.";
}

type SseEvent =
  | { type: "sources"; sources: RetrievedChunk[] }
  | { type: "token"; value: string }
  | { type: "done" }
  | { type: "error"; message: string; code: string };

/**
 * Retrieval + streaming generation.
 *
 * NOTE ON TRANSPORT: this is Server-Sent Events over a plain fetch(), not the
 * browser EventSource API, because EventSource cannot send an Authorization
 * header. The frontend parses the frame stream manually.
 */
export async function streamChat(req: Request, res: Response): Promise<void> {
  const { userId } = currentUser(req);
  const { message, documentIds } = requestSchema.parse(req.body);

  if (!chat.isAvailable()) {
    throw ApiError.llmUnavailable(
      "GEMINI_API_KEY is not configured on the server. Add it to backend/.env and restart.",
    );
  }

  // ── Retrieval happens BEFORE the response headers go out ────────────────
  // Retrieval is fast and lets us fail cleanly with a normal JSON error
  // (e.g. index not ready) instead of an error smuggled inside a 200 stream.
  const { chunks, allBelowThreshold } = await searchRelevantChunks(message, {
    userId,
    documentIds,
  });

  // ── SSE handshake ──────────────────────────────────────────────────────
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Disable proxy buffering, or nginx and friends will hold the whole
    // response until it completes and destroy the streaming effect.
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  const send = (event: SseEvent): void => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // A client navigating away or pressing "stop" closes the request. Aborting
  // the signal stops the model mid-stream instead of billing for tokens nobody
  // will read.
  const controller = new AbortController();
  req.on("close", () => controller.abort());

  let aborted = false;

  try {
    // Send sources first so the UI can render citations while the answer streams.
    send({ type: "sources", sources: chunks });

    if (chunks.length === 0) {
      // Nothing cleared the relevance floor. Rather than let the model fill
      // the gap from its own weights, stop here and tell the user what would
      // actually help.
      send({
        type: "error",
        code: "NO_CONTEXT",
        message: noContextMessage(
          message,
          (documentIds?.length ?? 0) > 0,
          allBelowThreshold,
        ),
      });
      send({ type: "done" });
      res.end();
      return;
    }

    const messages: ChatMessage[] = [
      { role: "system", content: buildSystemPrompt(chunks) },
      { role: "user", content: message },
    ];

    for await (const token of chat.stream(messages, controller.signal)) {
      send({ type: "token", value: token });
    }

    if (!controller.signal.aborted) {
      send({ type: "done" });
    }
  } catch (error) {
    if (controller.signal.aborted) {
      aborted = true;
      logger.info("Client disconnected mid-stream; generation aborted.");
    } else {
      logger.error("Streaming failed", error);
      const apiError =
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              "STREAM_FAILED",
              "The response stream failed unexpectedly.",
            );

      // The headers are already sent, so this can only be an in-band event.
      send({ type: "error", code: apiError.code, message: apiError.message });
      send({ type: "done" });
    }
  } finally {
    if (!aborted) res.end();
  }
}
