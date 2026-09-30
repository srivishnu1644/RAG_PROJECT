import { API_BASE, ApiError, getToken } from "./api";
import type { RetrievedSource } from "./types";

export type SseEvent =
  | { type: "sources"; sources: RetrievedSource[] }
  | { type: "token"; value: string }
  | { type: "done" }
  | { type: "error"; message: string; code: string };

export interface StreamHandlers {
  onSources?: (sources: RetrievedSource[]) => void;
  onToken: (token: string) => void;
  /**
   * `code` is the server's stable machine code, e.g. "NO_CONTEXT". Callers
   * branch on it to decide whether a message is worth surfacing as a toast
   * or is better left inline next to the question that caused it.
   */
  onError?: (message: string, code: string) => void;
}

/**
 * Streams a chat response via Server-Sent Events.
 *
 * Deliberately built on fetch + ReadableStream rather than EventSource:
 * EventSource cannot set an Authorization header, and every endpoint here
 * requires a Bearer token.
 *
 * SSE frames are separated by a blank line, but a chunk boundary can land
 * mid-frame, so we buffer until we see the full "\n\n" terminator.
 */
export async function streamChatRequest(
  message: string,
  documentIds: string[] | undefined,
  handlers: StreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/chat/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message,
        ...(documentIds && documentIds.length > 0 ? { documentIds } : {}),
      }),
      signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") return;
    throw new ApiError(0, "NETWORK_ERROR", "Lost connection to the server.");
  }

  // A non-2xx here is a pre-stream failure (auth, bad index, no API key) and
  // still arrives as a normal JSON error envelope.
  if (!response.ok) {
    const text = await response.text();
    let code = "UNKNOWN";
    let message = `Request failed with status ${response.status}.`;
    try {
      const parsed = JSON.parse(text) as {
        error?: { code?: string; message?: string };
      };
      code = parsed.error?.code ?? code;
      message = parsed.error?.message ?? message;
    } catch {
      /* keep defaults */
    }
    throw new ApiError(response.status, code, message);
  }

  if (!response.body) {
    throw new ApiError(
      500,
      "NO_BODY",
      "The server sent an empty response stream.",
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Frames are separated by a blank line. Tolerate \r\n for safety.
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const dataLine = frame
          .split("\n")
          .find((line) => line.startsWith("data:"));
        if (dataLine) {
          handleFrame(dataLine.slice(5).trim(), handlers);
        }

        boundary = buffer.indexOf("\n\n");
      }
    }
  } catch (error) {
    if ((error as Error).name === "AbortError") return;
    throw new ApiError(
      0,
      "STREAM_INTERRUPTED",
      "The response stream was interrupted.",
    );
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

function handleFrame(raw: string, handlers: StreamHandlers): void {
  if (raw === "[DONE]") return;

  let event: SseEvent;
  try {
    event = JSON.parse(raw) as SseEvent;
  } catch {
    // A malformed frame should not kill an otherwise healthy stream.
    return;
  }

  switch (event.type) {
    case "sources":
      handlers.onSources?.(event.sources);
      break;
    case "token":
      handlers.onToken(event.value);
      break;
    case "error":
      handlers.onError?.(event.message, event.code);
      break;
    case "done":
      break;
  }
}
