/** Role-tagged chat message, provider-neutral. */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatProvider {
  readonly name: string;

  /**
   * Streams the assistant's reply token-by-token.
   * Must respect `signal` so a client disconnect stops billing immediately.
   */
  stream(
    messages: ChatMessage[],
    signal: AbortSignal,
  ): AsyncGenerator<string, void, undefined>;

  /** True when the provider is usable right now (key present, etc). */
  isAvailable(): boolean;
}

export { ApiError } from "../../utils/ApiError.js";
