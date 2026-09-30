import { motion } from "motion/react";
import { Bot, Info, User as UserIcon } from "lucide-react";
import type { ChatMessage } from "../../lib/types";
import { Markdown, StreamingCaret } from "./Markdown";
import { SourceList } from "./SourceList";
import { RetrievalSkeleton } from "../ui/Shimmer";

interface MessageBubbleProps {
  message: ChatMessage;
}

/**
 * One turn in the conversation.
 *
 * Layout note: assistant turns are flush-left in the reading column with no
 * bubble and no border — long-form model output reads better as a document
 * than as a chat balloon, and it lets the prose use the full measure. User
 * turns stay distinct as a warm pill. The `layout` prop is deliberately
 * absent: it re-measures on every frame and is the source of the jitter that
 * makes streamed text hard to read.
 */
export function MessageBubble({
  message,
}: MessageBubbleProps): React.ReactNode {
  const isUser = message.role === "user";

  // Nothing has streamed yet: show the search-in-progress placeholder rather
  // than an empty bubble.
  if (message.streaming && message.content.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="flex gap-3.5"
      >
        <Avatar isUser={false} />
        <div className="min-w-0 flex-1 pt-1">
          <RetrievalSkeleton />
        </div>
      </motion.div>
    );
  }

  if (isUser) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 340, damping: 32 }}
        className="flex justify-end gap-3.5"
      >
        <div className="max-w-[85%] rounded-lg rounded-br-xs bg-surface-card px-4 py-2.5 text-read whitespace-pre-wrap text-body-strong">
          {message.content}
        </div>
        <Avatar isUser />
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 340, damping: 32 }}
      className="flex gap-3.5"
    >
      <Avatar isUser={false} />

      <div className="min-w-0 flex-1">
        {message.error ? (
          /*
           * Guidance, not an alert. The server's message is specific and
           * actionable — it distinguishes "nothing resembles this" from
           * "your library is empty" — so it is rendered through the same
           * markdown grammar as an answer, one step quieter, with a muted
           * icon for the only visual distinction it needs. No error colour:
           * the user did nothing wrong, so nothing is rendered as a failure.
           */
          <div className="rounded-lg border border-hairline bg-surface-soft/50">
            <div className="flex items-start gap-2.5 px-4 py-3">
              <Info
                className="mt-1 size-3.5 shrink-0 text-muted-soft"
                aria-hidden
              />
              <Markdown
                content={
                  message.content ||
                  "Something went wrong. Try rephrasing the question, or check that your documents are still indexed."
                }
                density="quiet"
              />
            </div>
          </div>
        ) : (
          <>
            <Markdown content={message.content} />
            {message.streaming ? <StreamingCaret /> : null}
          </>
        )}

        {/*
         * Sources appear only once the answer has finished streaming.
         *
         * Retrieval delivers them first, so during generation the citation
         * block would appear ABOVE text that is still being written and then
         * be pushed down as tokens land — a moving target the eye cannot
         * settle on. Waiting also means the list is final: `Show N more`
         * cannot change its count mid-read.
         */}
        {!message.streaming &&
        message.sources &&
        message.sources.length > 0 &&
        !message.error ? (
          <SourceList sources={message.sources} />
        ) : null}
      </div>
    </motion.div>
  );
}

function Avatar({ isUser }: { isUser: boolean }): React.ReactNode {
  return (
    <div
      className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md ${
        isUser
          ? "bg-surface-card text-muted"
          : "bg-ink text-canvas dark:bg-primary dark:text-on-primary"
      }`}
    >
      {isUser ? (
        <UserIcon className="size-3.5" aria-hidden />
      ) : (
        <Bot className="size-3.5" aria-hidden />
      )}
    </div>
  );
}
