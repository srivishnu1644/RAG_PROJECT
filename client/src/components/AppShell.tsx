import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  X,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";
import type { DocumentSummary } from "../lib/types";
import { useTheme } from "../lib/useTheme";
import { Dropzone } from "./Dropzone";
import { DocumentList } from "./DocumentList";
import { ChatPane } from "./chat/ChatPane";
import { IconButton } from "./ui/Button";

/** Tailwind's `lg` breakpoint. At or below this the sidebar overlays. */
const OVERLAY_BREAKPOINT = 1024;

/** Dual-pane dashboard: library sidebar + streaming chat. */
export function AppShell(): ReactNode {
  const { user, logout } = useAuth();
  const { dark, toggleTheme } = useTheme();

  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loadingDocuments, setLoadingDocuments] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Starts closed on narrow screens: an overlay that covers the conversation
  // on first paint would hide the whole app behind a drawer.
  const [sidebarOpen, setSidebarOpen] = useState(
    () => window.matchMedia("(min-width: 1024px)").matches,
  );
  /** True while the sidebar is a fixed overlay rather than a flex sibling. */
  const [overlay, setOverlay] = useState(
    () => window.innerWidth < OVERLAY_BREAKPOINT,
  );

  /*
   * Cross the breakpoint cleanly. Growing past lg promotes the sidebar back to
   * a docked column (it should stay open, since a docked sidebar being hidden
   * is just an empty gutter); shrinking below lg turns it into a scrim-backed
   * overlay, which must close so it does not cover the conversation.
   */
  useEffect(() => {
    const query = window.matchMedia(`(min-width: ${OVERLAY_BREAKPOINT}px)`);

    const apply = (isDesktop: boolean): void => {
      setOverlay(!isDesktop);
      setSidebarOpen(isDesktop);
    };

    apply(query.matches);

    const onChange = (event: MediaQueryListEvent): void => apply(event.matches);

    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Escape closes the overlay. Only bound while it is actually overlaying, so
  // a docked sidebar is not dismissed by a stray keypress.
  useEffect(() => {
    if (!overlay || !sidebarOpen) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setSidebarOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlay, sidebarOpen]);

  // Lock the page behind the drawer so scrolling the chat underneath it is
  // not possible on touch devices.
  useEffect(() => {
    if (!overlay || !sidebarOpen) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [overlay, sidebarOpen]);

  const refreshDocuments = useCallback(async (): Promise<void> => {
    try {
      const { documents: list } = await api.get<{
        documents: DocumentSummary[];
      }>("/api/documents");
      setDocuments(list);
    } catch {
      // The sidebar is not critical; the chat surface still works.
      setDocuments([]);
    } finally {
      setLoadingDocuments(false);
    }
  }, []);

  useEffect(() => {
    void refreshDocuments();
  }, [refreshDocuments]);

  const toggleDocument = (id: string): void => {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  };

  // Up to two initials for the account chip. Derived from whichever of name
  // or email is present, so it is never blank.
  const initials = (() => {
    const source = user?.name?.trim() || user?.email || "";
    const words = source.split(/[\s@._-]+/).filter(Boolean);
    const letters = words.slice(0, 2).map((word) => word.charAt(0));
    return (letters.join("") || "A").toUpperCase();
  })();

  return (
    <div className="relative flex h-dvh overflow-hidden">
      <a href="#chat" className="skip-link">
        Skip to conversation
      </a>

      {/* ── Scrim ───────────────────────────────────────────────────────── */}
      {/* Only on narrow screens, where the sidebar floats over the chat. Tapping
          it is the expected way to dismiss the drawer on touch. */}
      <AnimatePresence>
        {overlay && sidebarOpen ? (
          <motion.button
            key="scrim"
            type="button"
            tabIndex={-1}
            aria-label="Close document library"
            onClick={() => setSidebarOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-30 bg-ink/35 backdrop-blur-[2px] lg:hidden"
          />
        ) : null}
      </AnimatePresence>

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {sidebarOpen ? (
          <motion.aside
            key="sidebar"
            initial={overlay ? { x: "-100%" } : { width: 0, opacity: 0 }}
            animate={overlay ? { x: 0 } : { width: 336, opacity: 1 }}
            exit={overlay ? { x: "-100%" } : { width: 0, opacity: 0 }}
            transition={
              overlay
                ? { type: "spring", stiffness: 380, damping: 38 }
                : { type: "spring", stiffness: 320, damping: 34 }
            }
            // Below lg the sidebar is fixed and floats above the conversation
            // (z-40 clears the scrim's z-30). At lg and above it becomes a
            // normal flex sibling in the flow, so the chat reflows beside it.
            //
            // The width cap is a vw, deliberately. A percentage here would
            // resolve against the containing block — which is the `relative`
            // shell, not the viewport — so the drawer would size itself to a
            // fraction of whatever the chat pane happens to be and collapse
            // to an unreadable sliver.
            className={`flex shrink-0 flex-col overflow-hidden border-hairline bg-surface-soft ${
              overlay
                ? "fixed inset-y-0 left-0 z-40 w-84 max-w-[86vw] border-r shadow-pop"
                : "border-r"
            }`}
          >
            {/* min-h-0 + flex-1 are load-bearing: this column must fill the
                aside exactly. Header and footer are shrink-0 so they keep
                their height, and the middle scrolls — without that, a short
                viewport lets the dropzone push the account footer out of the
                overflow-hidden aside, where it cannot be clicked.

                min-w matches the aside's w-84, and is dropped on the overlay
                where the drawer is width-capped below that — a fixed min-width
                there would overflow a narrow screen. */}
            <div
              className={`flex min-h-0 flex-1 flex-col p-5 ${
                overlay ? "min-w-0" : "min-w-84"
              }`}
            >
              <header className="flex shrink-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  {/* Wordmark: spike-mark prefix + serif display, per the
                      brand guidance that the mark is never inverted inside
                      the wordmark itself. */}
                  <h1 className="flex items-center gap-1.5 font-display text-[26px] leading-none text-ink">
                    <span className="spike-mark text-ink" aria-hidden />
                    Axiom
                  </h1>
                  <p className="mt-1.5 truncate text-caption text-muted">
                    {user?.name ?? user?.email}
                  </p>
                </div>

                <div className="flex items-center gap-0.5">
                  {/* On the overlay the chevron reads as "push back into the
                      page"; an X is the unambiguous close affordance. */}
                  {overlay ? (
                    <IconButton
                      label="Close library"
                      onClick={() => setSidebarOpen(false)}
                    >
                      <X className="size-4" aria-hidden />
                    </IconButton>
                  ) : (
                    <IconButton
                      label="Collapse sidebar"
                      onClick={() => setSidebarOpen(false)}
                    >
                      <PanelLeftClose className="size-4" aria-hidden />
                    </IconButton>
                  )}
                </div>
              </header>

              {/* The scroll region. Everything between the wordmark and the
                  account row lives here, so a short window scrolls the
                  library instead of hiding the sign-out control. */}
              <div className="mt-6 flex min-h-0 flex-1 flex-col overflow-y-auto">
                <div className="shrink-0">
                  <Dropzone
                    onUploaded={(document) => {
                      setDocuments((current) => [document, ...current]);
                    }}
                  />
                </div>

                <div className="mt-6 flex min-h-0 flex-1 flex-col">
                  <div className="mb-2.5 flex shrink-0 items-center justify-between">
                    <h2 className="label-caps">Library</h2>
                    {documents.length > 0 ? (
                      <span className="tnum rounded-pill bg-surface-card px-2 py-0.5 text-micro font-medium text-muted">
                        {documents.length}
                      </span>
                    ) : null}
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                    <DocumentList
                      documents={documents}
                      loading={loadingDocuments}
                      selectedIds={selectedIds}
                      onToggle={(id) => {
                        toggleDocument(id);
                        // On the overlay, picking a document is the user's way
                        // of saying "now show me the answer" — leaving the
                        // drawer open would bury the conversation they just
                        // scoped the search to.
                        if (overlay) setSidebarOpen(false);
                      }}
                      onDeleted={(id) => {
                        setDocuments((current) =>
                          current.filter((doc) => doc.id !== id),
                        );
                        setSelectedIds((current) =>
                          current.filter((value) => value !== id),
                        );
                      }}
                    />
                  </div>

                  {selectedIds.length > 0 ? (
                    <motion.p
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-3 shrink-0 border-t border-hairline pt-3 text-caption text-muted"
                    >
                      Searching within {selectedIds.length} selected document
                      {selectedIds.length === 1 ? "" : "s"}.
                    </motion.p>
                  ) : null}
                </div>
              </div>

              {/* ── Account footer ─────────────────────────────────────────── */}
              {/* Sign-out lives down here rather than in the header: it is a
                  destructive, infrequent action, and pairing it with the
                  signed-in identity makes clear which account it ends. The
                  theme toggle moves with it so the header keeps only
                  layout controls. */}
              <div className="mt-4 shrink-0 border-t border-hairline pt-4">
                <div className="flex items-center gap-2.5">
                  {/* Monogram avatar: the initial, not a generic person icon. */}
                  <div
                    className="flex size-8 shrink-0 items-center justify-center rounded-md bg-ink text-caption font-semibold text-canvas select-none dark:bg-canvas dark:text-ink"
                    aria-hidden
                  >
                    {initials}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-small font-medium text-ink">
                      {user?.name ?? "Account"}
                    </p>
                    <p className="meta truncate">{user?.email}</p>
                  </div>

                  <IconButton
                    label={
                      dark ? "Switch to light mode" : "Switch to dark mode"
                    }
                    onClick={toggleTheme}
                  >
                    {dark ? (
                      <Sun className="size-4" aria-hidden />
                    ) : (
                      <Moon className="size-4" aria-hidden />
                    )}
                  </IconButton>

                  <IconButton
                    label="Sign out"
                    onClick={logout}
                    className="hover:text-error"
                  >
                    <LogOut className="size-4" aria-hidden />
                  </IconButton>
                </div>
              </div>
            </div>
          </motion.aside>
        ) : null}
      </AnimatePresence>

      {/* ── Main ────────────────────────────────────────────────────────── */}
      {/* min-h-0 is load-bearing: without it this flex column sizes itself to
          its content instead of the h-dvh viewport, so the chat pane's
          overflow-y-auto has no bounded height to scroll within and long
          conversations get clipped off-screen. */}
      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Menu button. On narrow screens there is no docked sidebar to
            collapse, so this is the only way back to the library. */}
        {!sidebarOpen || overlay ? (
          <motion.button
            type="button"
            onClick={() => setSidebarOpen(true)}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            aria-label="Open document library"
            title="Open document library"
            className={`absolute top-3.5 left-3.5 z-10 inline-flex size-9 items-center justify-center rounded-md border border-hairline bg-canvas text-muted shadow-hair transition-colors hover:text-ink ${
              overlay ? "lg:hidden" : ""
            }`}
          >
            <PanelLeftOpen className="size-4" aria-hidden />
          </motion.button>
        ) : null}

        <ChatPane
          hasDocuments={documents.length > 0}
          selectedDocumentIds={selectedIds}
        />
      </main>
    </div>
  );
}
