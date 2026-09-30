import { useCallback, useEffect, useRef, useState } from "react";

const THEME_KEY = "rag.theme";

/** Matches the transition duration declared in index.css. */
const TRANSITION_MS = 260;

/**
 * Light/dark theme, applied to the document root once.
 *
 * The whole palette resolves through CSS variables (see the `.dark` block in
 * index.css), so toggling this single class re-tints every surface without any
 * component needing `dark:` variants. Initialised at the app root rather than
 * in AppShell so the auth screen is themed too — otherwise the first paint
 * after a reload flashes ivory before the shell mounts.
 */
export function useTheme(): { dark: boolean; toggleTheme: () => void } {
  const [dark, setDark] = useState(false);
  // Tracks the in-flight transition so a second toggle is applied directly
  // rather than queued into a transition the browser will reject.
  const transitionRef = useRef<ViewTransition | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(THEME_KEY);
    const prefersDark =
      stored === null &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;

    const next = stored === "dark" || prefersDark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
  }, []);

  const toggleTheme = useCallback((): void => {
    // Read the current state from the DOM rather than from `dark`, so this
    // callback does not need `dark` as a dependency.
    const root = document.documentElement;
    const next = !root.classList.contains("dark");

    const apply = (): void => {
      root.classList.toggle("dark", next);
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    };

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    /*
     * Wrap the swap in a View Transition.
     *
     * Without this the class flips and the browser re-resolves every custom
     * property in one frame, so the whole UI hard-cuts. The transition
     * captures the old frame, applies the change, and cross-fades — which
     * reads as one surface turning rather than a flicker.
     *
     * Two things this deliberately does NOT do:
     *
     *   - It does not run inside a `setState` updater. Starting a transition
     *     there is a side effect in a function React may call twice, and React
     *     may also re-render and commit DOM around it, which makes the
     *     browser skip the transition with "Transition was skipped".
     *   - It does not skip when a transition is already running. A second
     *     call while one is in flight is simply dropped by the browser, so
     *     the state is applied directly and the swap still happens.
     *
     * `startViewTransition` is feature-detected because Safari and Firefox do
     * not ship it yet; there the CSS transition on the tokens is the fallback.
     *
     * `theme-transition` scopes the CSS that styles the snapshot pair and is
     * removed on finish, with a timeout as a safety net in case `finished`
     * never settles.
     */
    if (!document.startViewTransition || prefersReducedMotion) {
      apply();
      setDark(next);
      return;
    }

    if (transitionRef.current) {
      // A transition is already running. Applying directly avoids queueing a
      // second one, which the browser would reject anyway.
      apply();
      setDark(next);
      return;
    }

    root.classList.add("theme-transition");

    let transition: ViewTransition;
    try {
      transition = document.startViewTransition(apply);
    } catch {
      // Older implementations can throw synchronously.
      apply();
      root.classList.remove("theme-transition");
      setDark(next);
      return;
    }

    transitionRef.current = transition;

    void transition.finished
      .catch(() => undefined)
      .finally(() => {
        transitionRef.current = null;
        root.classList.remove("theme-transition");
        setTimeout(
          () => root.classList.remove("theme-transition"),
          TRANSITION_MS * 4,
        );
        setDark((current) => (current === next ? current : next));
      });
  }, []);

  return { dark, toggleTheme };
}
