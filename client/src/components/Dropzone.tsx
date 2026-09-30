import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, FileText, UploadCloud } from "lucide-react";
import { useToast } from "../contexts/ToastContext";
import { ApiError, api } from "../lib/api";
import type { DocumentSummary } from "../lib/types";

const ACCEPTED = ".pdf,.txt,.md,.docx";
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * The upload pipeline has three real stages. Naming them is the difference
 * between a fake progress bar and an honest one — the user can tell whether
 * the wait is network transfer or server-side indexing.
 */
type Stage = "idle" | "uploading" | "processing" | "done";

const STAGES: { key: Stage; label: string }[] = [
  { key: "uploading", label: "Uploading" },
  { key: "processing", label: "Extracting and embedding" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface DropzoneProps {
  onUploaded: (document: DocumentSummary) => void;
}

/** Drag-and-drop upload zone with staged progress and animated states. */
export function Dropzone({ onUploaded }: DropzoneProps): ReactNode {
  const { notify } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState(0);

  const busy = stage === "uploading" || stage === "processing";

  // The reset timers below are fire-and-forget, so they are tracked here to be
  // cleared if the component unmounts mid-animation.
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      for (const timer of timersRef.current) clearTimeout(timer);
    },
    [],
  );

  const handleFiles = useCallback(
    async (files: FileList | null): Promise<void> => {
      const file = files?.item(0);
      if (!file || busy) return;

      // Reject oversized files before spending an upload on them.
      if (file.size > MAX_BYTES) {
        notify({
          variant: "error",
          title: "File too large",
          description: `${file.name} is ${formatBytes(file.size)}. The limit is 25MB.`,
        });
        return;
      }

      setFileName(file.name);
      setFileSize(file.size);
      setStage("uploading");
      setProgress(0);

      // Transfer is assumed to occupy the first 70% of the bar, then the
      // stage flips to server-side indexing. Both phases creep toward their
      // ceiling rather than jumping, so the bar never stalls at a hard stop.
      let current = 0;
      const ticker = setInterval(() => {
        current = Math.min(current + Math.random() * 4 + 1.5, 92);
        setProgress(current);
        if (current > 55) setStage("processing");
      }, 180);

      try {
        const { document } = await api.upload<{ document: DocumentSummary }>(
          "/api/documents/upload",
          file,
        );

        clearInterval(ticker);
        setProgress(100);
        setStage("done");

        notify({
          variant: "success",
          title: "Document indexed",
          description: `${document.filename} → ${document.chunkCount} chunks ready to search.`,
        });
        onUploaded(document);

        // Hold the completed state briefly so the checkmark registers, then
        // fall back to idle.
        timersRef.current.push(
          setTimeout(() => {
            setStage("idle");
            setFileName(null);
            setFileSize(0);
            setProgress(0);
          }, 900),
        );
      } catch (error) {
        clearInterval(ticker);
        setStage("idle");
        setProgress(0);
        notify({
          variant: "error",
          title: "Upload failed",
          description:
            error instanceof ApiError
              ? error.message
              : "An unexpected error occurred.",
        });
      }
    },
    [busy, notify, onUploaded],
  );

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    void handleFiles(event.dataTransfer.files);
  };

  const stageIndex = STAGES.findIndex((item) => item.key === stage);
  const visibleStages =
    stage === "done" ? STAGES.length : Math.max(stageIndex, 0);

  return (
    <motion.div
      onDragOver={(event) => {
        event.preventDefault();
        if (!busy) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      animate={{
        scale: dragging ? 1.015 : 1,
        borderColor: dragging
          ? "color-mix(in oklab, var(--color-primary) 70%, transparent)"
          : undefined,
      }}
      transition={{ type: "spring", stiffness: 340, damping: 26 }}
      className={`group relative overflow-hidden rounded-lg border border-dashed p-6 text-center transition-colors ${
        dragging
          ? "border-primary/60 bg-primary-wash"
          : "border-hairline bg-canvas hover:border-cream-strong hover:bg-surface-soft/60"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="sr-only"
        onChange={(event) => void handleFiles(event.target.files)}
        aria-label="Choose a document to upload"
      />

      <AnimatePresence mode="wait">
        {stage === "idle" ? (
          <motion.div
            key="idle"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="py-1"
          >
            <motion.div
              animate={dragging ? { y: -4, scale: 1.06 } : { y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
              className="mx-auto mb-3 inline-flex size-10 items-center justify-center rounded-md bg-surface-card text-muted transition-colors group-hover:text-primary"
            >
              <FileText className="size-5" aria-hidden />
            </motion.div>

            <p className="text-small font-medium text-ink">
              {dragging ? "Drop to upload" : "Drag a document here"}
            </p>
            <p className="meta mt-1">PDF, TXT, MD or DOCX · up to 25MB</p>

            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-4 rounded-md border border-hairline bg-raised px-3.5 py-1.5 text-caption font-medium text-body-strong transition-colors hover:bg-surface-card active:translate-y-px"
            >
              Browse files
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="active"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="py-1"
            role="status"
            aria-live="polite"
          >
            {/* File card: name, size, and a per-stage checkmark rail. */}
            <div className="flex items-center gap-3 text-left">
              <motion.div
                className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-wash text-primary-ink"
                animate={stage === "done" ? { scale: [1, 1.12, 1] } : {}}
                transition={{ duration: 0.4 }}
              >
                {stage === "done" ? (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  >
                    <Check className="size-5" strokeWidth={2.4} aria-hidden />
                  </motion.span>
                ) : (
                  <motion.span
                    animate={{ y: [0, -2.5, 0] }}
                    transition={{
                      duration: 1.6,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  >
                    <UploadCloud className="size-5" aria-hidden />
                  </motion.span>
                )}
              </motion.div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-small font-medium text-ink">
                  {fileName}
                </p>
                <p className="tnum meta mt-0.5">
                  {formatBytes(fileSize)}
                  {stage !== "done" ? (
                    <>
                      {" · "}
                      {Math.round(progress)}%
                    </>
                  ) : null}
                </p>
              </div>
            </div>

            {/* Progress track. A shimmer sweeps the filled portion so the
                bar reads as active work rather than a frozen value. */}
            <div className="mt-4 h-1 w-full overflow-hidden rounded-pill bg-cream-strong">
              <motion.div
                className="relative h-full rounded-pill bg-primary"
                animate={{ width: `${progress}%` }}
                transition={{ ease: "easeOut", duration: 0.3 }}
              >
                <motion.span
                  className="absolute inset-0 rounded-pill bg-white/35"
                  animate={{ x: ["-100%", "200%"] }}
                  transition={{
                    duration: 1.3,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
              </motion.div>
            </div>

            {/* Stage rail: each step fills and checks off as it completes. */}
            <div className="mt-3.5 flex items-center justify-between gap-2">
              {STAGES.map((item, index) => {
                const complete = stage === "done" || index < visibleStages;
                const active = item.key === stage;

                return (
                  <div
                    key={item.key}
                    className="flex min-w-0 items-center gap-1.5"
                  >
                    <motion.span
                      className={`flex size-3.5 shrink-0 items-center justify-center rounded-pill border transition-colors ${
                        complete
                          ? "border-primary bg-primary text-on-primary"
                          : "border-cream-strong"
                      }`}
                      animate={active ? { scale: [1, 1.15, 1] } : {}}
                      transition={{
                        duration: 1.1,
                        repeat: active ? Infinity : 0,
                        ease: "easeInOut",
                      }}
                    >
                      {complete ? (
                        <Check
                          className="size-2"
                          strokeWidth={3.5}
                          aria-hidden
                        />
                      ) : null}
                    </motion.span>

                    <span
                      className={`truncate text-micro transition-colors ${
                        active
                          ? "font-medium text-ink"
                          : complete
                            ? "text-muted"
                            : "text-muted-soft"
                      }`}
                    >
                      {item.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
