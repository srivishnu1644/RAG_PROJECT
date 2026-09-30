import { useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, FileText } from "lucide-react";
import type { RetrievedSource } from "../../lib/types";

interface SourceListProps {
  sources: RetrievedSource[];
}

interface GroupedSources {
  filename: string;
  /** Best combined score within the group, shown on the document header. */
  topScore: number;
  items: RetrievedSource[];
}

/**
 * Group passages by their source file, preserving reranked order.
 *
 * Reranking already limits how many passages any one document can contribute,
 * so this grouping is about legibility rather than about trimming: a flat
 * list makes it impossible to see which file a given quote came from.
 */
function groupByDocument(sources: RetrievedSource[]): GroupedSources[] {
  const groups = new Map<string, RetrievedSource[]>();

  for (const source of sources) {
    const existing = groups.get(source.filename);
    if (existing) existing.push(source);
    else groups.set(source.filename, [source]);
  }

  // Map preserves insertion order, which is reranked order — the file whose
  // best passage scored highest leads.
  return Array.from(groups, ([filename, items]) => ({
    filename,
    topScore: Math.max(...items.map((item) => item.rerankScore ?? item.score)),
    items,
  }));
}

/** How many passages to show before collapsing the rest. */
const COLLAPSE_AFTER = 3;

/** Compact citations: enough to verify a claim, not enough to re-read the file. */
export function SourceList({ sources }: SourceListProps): ReactNode {
  const [expanded, setExpanded] = useState(false);

  const groups = useMemo(() => groupByDocument(sources), [sources]);

  if (groups.length === 0) return null;

  const documentCount = groups.length;
  const hiddenCount = expanded
    ? 0
    : Math.max(sources.length - COLLAPSE_AFTER, 0);

  return (
    <div className="mt-5 overflow-hidden rounded-md border border-hairline">
      <div className="flex items-center justify-between gap-3 border-b border-hairline bg-surface-soft px-3 py-2">
        <p className="label-caps">Sources</p>
        <span className="tnum text-micro text-muted-soft">
          {documentCount} document{documentCount === 1 ? "" : "s"}
          {sources.length !== documentCount
            ? ` · ${sources.length} passage${sources.length === 1 ? "" : "s"}`
            : ""}
        </span>
      </div>

      <div className="flex flex-col gap-px bg-hairline-soft">
        {groups.map((group, groupIndex) => {
          // The first document is always shown in full — it holds the
          // passages the answer leaned on hardest. Later documents are
          // collapsed until the user asks for the rest.
          const visible =
            expanded || groupIndex === 0
              ? group.items
              : group.items.slice(0, 1);

          return (
            <section key={group.filename} className="bg-canvas px-3 py-2.5">
              {/* Document header. The name truncates rather than wraps: a
                  citation list is scanned, not read, and a two-line filename
                  doubles the block height for no added information. The full
                  name is available on hover and to screen readers. */}
              <div className="flex items-center gap-2">
                <FileText
                  className="size-3.5 shrink-0 text-muted-soft"
                  aria-hidden
                />
                <h3
                  className="min-w-0 flex-1 truncate text-caption font-medium text-body-strong"
                  title={group.filename}
                >
                  {group.filename}
                </h3>
                <span
                  className="tnum shrink-0 font-mono text-micro text-muted-soft"
                  title={`Best combined match in this document: ${group.topScore.toFixed(3)}`}
                >
                  {group.topScore.toFixed(2)}
                </span>
              </div>

              <ul className="mt-1.5 flex flex-col">
                <AnimatePresence initial={false}>
                  {visible.map((source) => {
                    const score = source.rerankScore ?? source.score;

                    return (
                      <motion.li
                        key={source.chunkId}
                        layout
                        initial={{ opacity: 0, y: -3 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{
                          type: "spring",
                          stiffness: 420,
                          damping: 34,
                        }}
                        className="flex items-baseline gap-2 py-0.5"
                      >
                        <span className="tnum shrink-0 font-mono text-micro text-muted-soft">
                          {source.chunkIndex}
                        </span>

                        {/*
                         * The excerpt is the part of the chunk that actually
                         * answers the question, picked server-side by the
                         * reranker. A full ~1000-character chunk is evidence,
                         * not a citation — this is the sentence or two the
                         * claim rests on.
                         */}
                        <span
                          className="min-w-0 flex-1 text-caption leading-snug text-muted"
                          title={source.excerpt ?? source.text}
                        >
                          {source.excerpt ?? source.text}
                        </span>

                        <span
                          className="tnum shrink-0 font-mono text-micro text-muted-soft/80"
                          title={`Relevance: ${score.toFixed(3)}`}
                        >
                          {score.toFixed(2)}
                        </span>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            </section>
          );
        })}
      </div>

      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center justify-center gap-1 border-t border-hairline bg-surface-soft px-3 py-1.5 text-micro text-muted transition-colors hover:text-ink"
        >
          <ChevronDown className="size-3" aria-hidden />
          Show {hiddenCount} more
        </button>
      ) : expanded && sources.length > COLLAPSE_AFTER ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="flex w-full items-center justify-center gap-1 border-t border-hairline bg-surface-soft px-3 py-1.5 text-micro text-muted transition-colors hover:text-ink"
        >
          <motion.span
            animate={{ rotate: 180 }}
            transition={{ duration: 0.2 }}
            className="inline-flex"
          >
            <ChevronDown className="size-3" aria-hidden />
          </motion.span>
          Show fewer
        </button>
      ) : null}
    </div>
  );
}
