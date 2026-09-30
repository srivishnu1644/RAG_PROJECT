import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { motion } from "motion/react";
import { ArrowUp, Square } from "lucide-react";

interface ComposerProps {
  disabled: boolean;
  streaming: boolean;
  onSend: (message: string) => void;
  onStop: () => void;
}

const MAX_HEIGHT = 168;

export function Composer({
  disabled,
  streaming,
  onSend,
  onStop,
}: ComposerProps): ReactNode {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow up to a cap, then scroll internally.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;

    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  const submit = (): void => {
    const trimmed = value.trim();
    if (!trimmed || disabled || streaming) return;

    onSend(trimmed);
    setValue("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter sends; Shift+Enter inserts a newline.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const canSend = value.trim().length > 0 && !disabled && !streaming;

  return (
    <div className="border-t border-hairline bg-canvas/85 px-5 pt-4 pb-5 backdrop-blur-xl">
      <div className="mx-auto flex max-w-3xl items-end gap-2.5">
        <div className="flex-1 rounded-lg border border-hairline bg-raised shadow-hair transition-colors focus-within:border-primary/45">
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            disabled={disabled}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              disabled
                ? "Upload a document to start asking questions…"
                : "Ask a question about your documents…"
            }
            aria-label="Message"
            className="max-h-42 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-read text-ink placeholder:text-muted-soft focus:outline-none disabled:cursor-not-allowed"
          />
          {/* Hint sits below the input rather than inline so the bar keeps a
              single quiet surface. Hidden once disabled to avoid noise. */}
          <p className="meta px-4 pt-0.5 pb-3">
            <kbd className="font-mono">Enter</kbd> to send ·{" "}
            <kbd className="font-mono">Shift + Enter</kbd> for a new line
          </p>
        </div>

        {streaming ? (
          <motion.button
            type="button"
            onClick={onStop}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.92 }}
            transition={{ type: "spring", stiffness: 500, damping: 24 }}
            aria-label="Stop generating"
            title="Stop generating"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-pill bg-ink text-canvas transition-colors hover:bg-body-strong dark:bg-canvas dark:text-ink dark:hover:bg-body"
          >
            <Square className="size-3.5 fill-current" aria-hidden />
          </motion.button>
        ) : (
          <motion.button
            type="button"
            onClick={submit}
            disabled={!canSend}
            whileHover={canSend ? { scale: 1.05 } : undefined}
            whileTap={canSend ? { scale: 0.9 } : undefined}
            transition={{ type: "spring", stiffness: 500, damping: 24 }}
            aria-label="Send message"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-pill bg-primary text-on-primary transition-colors hover:bg-primary-active disabled:cursor-not-allowed disabled:bg-cream-strong disabled:text-muted-soft"
          >
            <ArrowUp className="size-[18px]" strokeWidth={2.2} aria-hidden />
          </motion.button>
        )}
      </div>
    </div>
  );
}
