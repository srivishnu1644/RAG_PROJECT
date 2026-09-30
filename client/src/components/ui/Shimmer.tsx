import type { ReactNode } from "react";

interface ShimmerProps {
  className?: string;
}

/** Single animated placeholder block. */
export function Shimmer({ className = "" }: ShimmerProps): ReactNode {
  return <div className={`shimmer rounded-sm ${className}`} aria-hidden />;
}

/**
 * Placeholder shown while the vector search runs, so the user sees movement
 * during the round trip instead of an unexplained pause.
 */
export function RetrievalSkeleton(): ReactNode {
  return (
    <div
      className="flex flex-col gap-2.5"
      role="status"
      aria-label="Searching your documents"
    >
      <div className="flex items-center gap-2 text-caption text-muted">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-pulse-ring rounded-pill bg-primary" />
          <span className="relative inline-flex size-2 rounded-pill bg-primary" />
        </span>
        Searching your documents…
      </div>
      <Shimmer className="h-3.5 w-[92%]" />
      <Shimmer className="h-3.5 w-[78%]" />
      <Shimmer className="h-3.5 w-[85%]" />
    </div>
  );
}

/** Row-shaped placeholder for the document list. */
export function DocumentSkeleton({ count = 3 }: { count?: number }): ReactNode {
  return (
    <div
      className="flex flex-col gap-px overflow-hidden rounded-md border border-hairline bg-hairline-soft"
      role="status"
      aria-label="Loading documents"
    >
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-2.5 bg-canvas py-2.5 pr-2 pl-3"
        >
          <Shimmer className="h-8 w-4 shrink-0 rounded-sm" />
          <div className="flex-1 space-y-1.5">
            <Shimmer className="h-3 w-1/2" />
            <Shimmer className="h-2.5 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
