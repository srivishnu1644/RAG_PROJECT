import { AnimatePresence, motion } from "motion/react";
import { FileText, Trash2 } from "lucide-react";
import { useToast } from "../contexts/ToastContext";
import { ApiError, api } from "../lib/api";
import type { DocumentSummary } from "../lib/types";
import { IconButton } from "./ui/Button";
import { DocumentSkeleton } from "./ui/Shimmer";

interface DocumentListProps {
  documents: DocumentSummary[];
  loading: boolean;
  selectedIds: string[];
  onToggle: (id: string) => void;
  onDeleted: (id: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentList({
  documents,
  loading,
  selectedIds,
  onToggle,
  onDeleted,
}: DocumentListProps): React.ReactNode {
  const { notify } = useToast();

  const handleDelete = async (document: DocumentSummary): Promise<void> => {
    try {
      await api.delete<{ chunksRemoved: number }>(
        `/api/documents/${document.id}`,
      );
      onDeleted(document.id);
      notify({
        variant: "success",
        title: "Document removed",
        description: `${document.filename} was deleted from your library.`,
      });
    } catch (error) {
      notify({
        variant: "error",
        title: "Could not delete document",
        description:
          error instanceof ApiError
            ? error.message
            : "An unexpected error occurred.",
      });
    }
  };

  if (loading) return <DocumentSkeleton />;

  if (documents.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-hairline px-4 py-8 text-center">
        <p className="text-small text-muted">No documents yet</p>
        <p className="meta mt-1">Upload a file to build your library.</p>
      </div>
    );
  }

  return (
    // Staggered entrance: each row lands slightly after the last.
    <motion.ul
      className="flex flex-col gap-px overflow-hidden rounded-md border border-hairline bg-hairline-soft"
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: 0.05 } },
      }}
    >
      <AnimatePresence initial={false}>
        {documents.map((document) => {
          const selected = selectedIds.includes(document.id);

          return (
            <motion.li
              key={document.id}
              layout
              variants={{
                hidden: { opacity: 0, y: 10 },
                visible: { opacity: 1, y: 0 },
              }}
              exit={{ opacity: 0, x: -24, height: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
              className={`group flex items-center gap-2.5 py-2.5 pr-2 pl-3 transition-colors ${
                selected ? "bg-primary-wash" : "bg-canvas hover:bg-surface-soft"
              }`}
            >
              <button
                type="button"
                onClick={() => onToggle(document.id)}
                aria-pressed={selected}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
              >
                {/* Selection indicator is a left rule, not a filled chip —
                    the row stays quiet and the coral reads as state. */}
                <span
                  className={`h-8 w-0.5 shrink-0 rounded-pill transition-colors ${
                    selected ? "bg-primary" : "bg-transparent"
                  }`}
                  aria-hidden
                />

                <FileText
                  className={`size-4 shrink-0 transition-colors ${
                    selected ? "text-primary-ink" : "text-muted-soft"
                  }`}
                  aria-hidden
                />

                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-small font-medium ${
                      selected ? "text-ink" : "text-body-strong"
                    }`}
                  >
                    {document.filename}
                  </span>
                  <span className="tnum meta mt-0.5 block">
                    {document.chunkCount} chunks ·{" "}
                    {formatBytes(document.sizeBytes)}
                  </span>
                </span>
              </button>

              <IconButton
                label={`Delete ${document.filename}`}
                onClick={() => void handleDelete(document)}
                // Reveal-on-hover only works with a pointer. On touch there is
                // no hover, so the control would simply never appear — which
                // makes documents undeletable on a phone. `md:opacity-100`
                // shows it from the md breakpoint up, where hover is the norm,
                // and below that it stays visible for finger input.
                className="opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 hover:text-error"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </IconButton>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </motion.ul>
  );
}
