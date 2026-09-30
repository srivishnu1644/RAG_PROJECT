import { useState, type FormEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Lock, Mail, User as UserIcon } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { ApiError } from "../lib/api";
import { Button } from "../components/ui/Button";

type Mode = "login" | "register";

export function AuthScreen(): ReactNode {
  const { login, register } = useAuth();
  const { notify } = useToast();

  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isRegister = mode === "register";

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);

    try {
      if (isRegister) {
        await register(name, email, password);
        notify({
          variant: "success",
          title: "Account created",
          description: "Welcome to Axiom.",
        });
      } else {
        await login(email, password);
        notify({ variant: "success", title: "Signed in" });
      }
    } catch (error) {
      notify({
        variant: "error",
        title: isRegister ? "Could not create account" : "Could not sign in",
        description:
          error instanceof ApiError ? error.message : "Something went wrong.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // text-input: raised field, hairline border, coral focus ring. Placeholder
  // is muted-soft on cream — AA at 12.5px is 4.6:1, so it is legible.
  const inputClass =
    "w-full rounded-md border border-hairline bg-raised py-2.5 pr-3 pl-10 text-ui text-ink " +
    "transition-colors placeholder:text-muted-soft hover:border-cream-strong " +
    "focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/12";

  const labelClass = "mb-1.5 block text-caption font-medium text-muted";

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-12">
      {/* A single warm wash behind the card. Claude's entry pages are flat and
          quiet — two drifting orbs read as a template, one wash reads as light. */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        aria-hidden
        style={{
          background:
            "radial-gradient(60% 45% at 50% 0%, color-mix(in oklab, var(--color-primary) 9%, transparent) 0%, transparent 70%)",
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 26 }}
        className="w-full max-w-[400px] rounded-lg border border-hairline bg-raised p-8 shadow-lift"
      >
        <div className="mb-8 text-center">
          {/* The brand mark does the work here; no icon tile. */}
          <motion.div
            initial={{ rotate: -18, scale: 0.7, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 18,
              delay: 0.1,
            }}
            className="mb-4 flex justify-center"
          >
            <span className="spike-mark text-3xl text-primary" aria-hidden />
          </motion.div>

          <h1 className="font-display text-[32px] leading-none text-ink">
            Axiom
          </h1>
          <p className="mt-2.5 text-small leading-relaxed text-muted">
            {isRegister
              ? "Create an account to start indexing your documents."
              : "Sign in to search your document library."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <AnimatePresence initial={false} mode="popLayout">
            {isRegister ? (
              <motion.div
                key="name"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.22 }}
                className="overflow-hidden"
              >
                <div className="pb-1">
                  <label htmlFor="auth-name" className={labelClass}>
                    Name
                  </label>
                  <div className="relative">
                    <UserIcon
                      className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-soft"
                      aria-hidden
                    />
                    <input
                      id="auth-name"
                      type="text"
                      required
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Your name"
                      autoComplete="name"
                      className={inputClass}
                    />
                  </div>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <div>
            <label htmlFor="auth-email" className={labelClass}>
              Email
            </label>
            <div className="relative">
              <Mail
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-soft"
                aria-hidden
              />
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label htmlFor="auth-password" className={labelClass}>
              Password
            </label>
            <div className="relative">
              <Lock
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-soft"
                aria-hidden
              />
              <input
                id="auth-password"
                type="password"
                required
                minLength={isRegister ? 8 : undefined}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={isRegister ? "At least 8 characters" : "Password"}
                autoComplete={isRegister ? "new-password" : "current-password"}
                className={inputClass}
              />
            </div>
          </div>

          <Button
            type="submit"
            loading={submitting}
            className="mt-2 w-full"
            size="lg"
          >
            {isRegister ? "Create account" : "Sign in"}
          </Button>
        </form>

        <p className="mt-7 text-center text-small text-muted">
          {isRegister ? "Already have an account?" : "Don't have an account?"}{" "}
          <button
            type="button"
            onClick={() => setMode(isRegister ? "login" : "register")}
            className="text-link font-medium"
          >
            {isRegister ? "Sign in" : "Create one"}
          </button>
        </p>
      </motion.div>
    </div>
  );
}
