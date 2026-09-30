import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

export type ToastVariant = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
}

interface ToastContextValue {
  notify: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 6000;

const VARIANT_STYLES: Record<ToastVariant, { ring: string; icon: ReactNode }> =
  {
    success: {
      ring: "border-success/35",
      icon: <CheckCircle2 className="size-4 text-success" aria-hidden />,
    },
    error: {
      ring: "border-error/35",
      icon: <XCircle className="size-4 text-error" aria-hidden />,
    },
    warning: {
      ring: "border-warning/35",
      icon: <AlertTriangle className="size-4 text-warning" aria-hidden />,
    },
    info: {
      ring: "border-hairline",
      icon: <Info className="size-4 text-primary" aria-hidden />,
    },
  };

export function ToastProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string): void => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const notify = useCallback(
    (toast: Omit<Toast, "id">): void => {
      const id = crypto.randomUUID();

      // Cap the stack so a burst of upload failures cannot bury the screen.
      setToasts((current) => [...current, { ...toast, id }].slice(-4));

      timers.current.set(
        id,
        setTimeout(() => dismiss(id), AUTO_DISMISS_MS),
      );
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({ notify, dismiss }),
    [notify, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* role=status so screen readers announce errors without stealing focus */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-4 z-60 flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-6 sm:items-end"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: -14, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 32, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className={`pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-md border bg-raised px-3.5 py-3 shadow-pop ${VARIANT_STYLES[toast.variant].ring}`}
            >
              <div className="mt-0.5 shrink-0">
                {VARIANT_STYLES[toast.variant].icon}
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-small font-semibold text-ink">
                  {toast.title}
                </p>
                {toast.description ? (
                  <p className="mt-0.5 text-caption leading-relaxed text-muted">
                    {toast.description}
                  </p>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss notification"
                className="shrink-0 rounded-sm p-1 text-muted-soft transition-colors hover:bg-surface-card hover:text-ink"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside a ToastProvider.");
  }
  return context;
}
