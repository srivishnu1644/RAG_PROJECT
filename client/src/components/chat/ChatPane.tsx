import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import { useToast } from "../../contexts/ToastContext";
import { streamChatRequest } from "../../lib/sse";
import { ApiError } from "../../lib/api";
import type { ChatMessage, RetrievedSource } from "../../lib/types";
import { MessageBubble } from "./MessageBubble";
import { Composer } from "./Composer";

interface ChatPaneProps {
  hasDocuments: boolean;
  selectedDocumentIds: string[];
}

const STARTERS = [
  "Summarise the key points across my documents.",
  "What are the main topics covered?",
  "Find any dates, deadlines or numbers mentioned.",
];

export function ChatPane({
  hasDocuments,
  selectedDocumentIds,
}: ChatPaneProps): ReactNode {
  const { notify } = useToast();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  /*
   * Streaming is buffered and flushed once per animation frame.
   *
   * Without this, every SSE token triggers its own setState, so a 600-token
   * answer causes 600 full re-renders of the whole message list inside a few
   * seconds — the page visibly stutters and the caret flickers backwards.
   * Accumulating into a string ref and committing per frame caps the work at
   * one render per display refresh, which is what makes the text read as
   * smooth token-by-token growth.
   */
  const tokenBufferRef = useRef("");
  const frameRef = useRef<number | null>(null);
  // Latched when the user scrolls up mid-stream, so the auto-scroll stops
  // fighting them until they return to the bottom.
  const pinnedRef = useRef(true);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const onScroll = (): void => {
      const distance =
        element.scrollHeight - element.scrollTop - element.clientHeight;
      pinnedRef.current = distance < 120;
    };

    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, []);

  // Keep the newest message in view as tokens arrive, but don't yank the
  // viewport if the user has scrolled up to re-read something.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !pinnedRef.current) return;

    element.scrollTop = element.scrollHeight;
  }, [messages]);

  // Abort any in-flight stream if the component unmounts mid-generation.
  useEffect(() => () => abortRef.current?.abort(), []);

  const send = async (text: string): Promise<void> => {
    const controller = new AbortController();
    abortRef.current = controller;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    const assistantId = crypto.randomUUID();
    tokenBufferRef.current = "";
    pinnedRef.current = true;

    setMessages((current) => [
      ...current,
      userMessage,
      { id: assistantId, role: "assistant", content: "", streaming: true },
    ]);
    setStreaming(true);

    /** Applies a mutation to the streaming assistant message only. */
    const updateAssistant = (
      mutate: (message: ChatMessage) => ChatMessage,
    ): void => {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId ? mutate(message) : message,
        ),
      );
    };

    /**
     * Drains the token buffer into React state exactly once per frame. Any
     * token that arrived since the last frame is committed together, so the
     * assistant message grows in visible steps instead of thrashing.
     */
    const flushTokens = (): void => {
      if (frameRef.current !== null) return;

      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;

        const chunk = tokenBufferRef.current;
        if (chunk.length === 0) return;

        tokenBufferRef.current = "";
        updateAssistant((message) => ({
          ...message,
          content: message.content + chunk,
        }));
      });
    };

    /** Commits any buffered tokens synchronously, for use on teardown. */
    const flushNow = (): void => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }

      const chunk = tokenBufferRef.current;
      if (chunk.length === 0) return;

      tokenBufferRef.current = "";
      updateAssistant((message) => ({
        ...message,
        content: message.content + chunk,
      }));
    };

    try {
      await streamChatRequest(
        text,
        selectedDocumentIds,
        {
          onSources: (sources: RetrievedSource[]) => {
            updateAssistant((message) => ({ ...message, sources }));
          },
          onToken: (token: string) => {
            // Buffered, not set directly — see flushTokens above.
            tokenBufferRef.current += token;
            flushTokens();
          },
          onError: (message: string, code: string) => {
            updateAssistant((current) => ({
              ...current,
              content: current.content || message,
              error: true,
            }));
            // NO_CONTEXT renders its guidance inline in the transcript, where
            // it sits next to the question that caused it. A toast repeating
            // the same sentence is noise, so it is suppressed.
            if (code === "NO_CONTEXT") return;
            notify({
              variant: "warning",
              title: "Search incomplete",
              description: message,
            });
          },
        },
        controller.signal,
      );
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        const description =
          error instanceof ApiError
            ? error.message
            : "An unexpected error occurred.";
        updateAssistant((message) => ({
          ...message,
          content: message.content || description,
          error: true,
        }));
        notify({ variant: "error", title: "Request failed", description });
      }
    } finally {
      // Anything still buffered must land before the caret is removed,
      // otherwise the last few tokens of every answer are dropped.
      flushNow();
      updateAssistant((message) => ({ ...message, streaming: false }));
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const stop = (): void => {
    abortRef.current?.abort();
  };

  const empty = messages.length === 0;

  return (
    // min-h-0 for the same reason as AppShell's <main>: this is the last
    // flex ancestor above the scroll container, so it must be allowed to
    // shrink to the viewport height rather than growing to fit the messages.
    <section
      id="chat"
      tabIndex={-1}
      className="flex min-h-0 min-w-0 flex-1 flex-col focus:outline-none"
    >
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-5 pt-14 pb-6 sm:pt-10"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-8">
          {empty ? (
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 240, damping: 28 }}
              className="flex flex-col items-center py-14 text-center"
            >
              {/* The spike mark, not a filled coral square. Claude's empty
                  state is typographic, so the ornament stays hairline. */}
              <div className="mb-6 flex size-14 items-center justify-center rounded-lg border border-hairline bg-raised">
                <span
                  className="spike-mark text-2xl text-primary"
                  aria-hidden
                />
              </div>

              <h2 className="font-display text-display-sm text-ink">
                {hasDocuments
                  ? "Ask anything about your documents"
                  : "Your library is empty"}
              </h2>
              <p className="mt-2 max-w-md text-read text-muted text-pretty">
                {hasDocuments
                  ? "Answers are grounded in the passages retrieved from your files, and every claim links back to a source you can check."
                  : "Upload a PDF, TXT, MD or DOCX file to start building a searchable knowledge base."}
              </p>

              {hasDocuments ? (
                <div className="mt-8 flex w-full max-w-md flex-col gap-2">
                  {STARTERS.map((starter, index) => (
                    <motion.button
                      key={starter}
                      type="button"
                      onClick={() => void send(starter)}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 + index * 0.06 }}
                      whileTap={{ scale: 0.99 }}
                      className="group flex items-center justify-between gap-4 rounded-md border border-hairline bg-raised px-4 py-3 text-left text-small text-body transition-colors hover:border-primary/35 hover:text-ink"
                    >
                      <span>{starter}</span>
                      <ArrowUpRight
                        className="size-4 shrink-0 text-muted-soft transition-colors group-hover:text-primary"
                        aria-hidden
                      />
                    </motion.button>
                  ))}
                </div>
              ) : null}
            </motion.div>
          ) : (
            <AnimatePresence initial={false}>
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>

      <Composer
        disabled={!hasDocuments}
        streaming={streaming}
        onSend={(text) => void send(text)}
        onStop={stop}
      />
    </section>
  );
}
