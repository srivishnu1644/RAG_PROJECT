import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ToastProvider } from "./contexts/ToastContext";
import { AuthScreen } from "./components/AuthScreen";
import { AppShell } from "./components/AppShell";
import { useTheme } from "./lib/useTheme";

/** Full-screen loading state while the stored session is validated. */
function BootScreen(): ReactNode {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        {/* A generic spinner here is the first thing a user sees; the wordmark
            plus a coral rule says "this app" instead of "something is loading". */}
        <motion.div
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        >
          <span className="spike-mark text-2xl text-primary" aria-hidden />
        </motion.div>
        <p className="text-caption text-muted">Restoring your session…</p>
      </div>
    </div>
  );
}

function Root(): ReactNode {
  const { user, initialising } = useAuth();

  // Applied here rather than inside AppShell so the theme is settled before
  // either screen paints, including the auth screen.
  useTheme();

  if (initialising) return <BootScreen />;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={user ? "app" : "auth"}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
        className="min-h-dvh"
      >
        {user ? <AppShell /> : <AuthScreen />}
      </motion.div>
    </AnimatePresence>
  );
}

export default function App(): ReactNode {
  return (
    <ToastProvider>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </ToastProvider>
  );
}
