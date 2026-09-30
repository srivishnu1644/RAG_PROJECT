import { forwardRef, type ReactNode } from "react";
import { motion, type HTMLMotionProps } from "motion/react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  // button-primary: the signature coral CTA. Flat fill, no gradient — the
  // system reaches for depth via surface contrast, not paint effects.
  primary:
    "bg-primary text-on-primary hover:bg-primary-active active:bg-primary-active",
  // button-secondary: raised cream with a hairline outline.
  secondary:
    "bg-raised text-ink border border-hairline hover:bg-surface-soft hover:border-cream-strong",
  ghost: "text-muted hover:bg-surface-card hover:text-ink",
  danger: "bg-transparent text-error border border-error/30 hover:bg-error/8",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-caption gap-1.5",
  // 40px tall: the documented minimum touch target.
  md: "h-10 px-4 text-small gap-2",
  lg: "h-11 px-5 text-ui gap-2",
};

/**
 * Extends motion's own button props rather than the DOM ones: motion redefines
 * handlers such as onAnimationStart, so the React DOM types are not assignable.
 */
interface ButtonProps extends HTMLMotionProps<"button"> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      loading = false,
      children,
      className = "",
      disabled,
      ...rest
    },
    ref,
  ) {
    return (
      <motion.button
        ref={ref}
        // Spring-based micro-interactions give the tactile "haptic" feel the
        // brief asks for on every interactive surface.
        whileHover={disabled || loading ? undefined : { scale: 1.03, y: -1 }}
        whileTap={disabled || loading ? undefined : { scale: 0.96 }}
        transition={{ type: "spring", stiffness: 500, damping: 26 }}
        disabled={disabled || loading}
        className={`inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
        {...rest}
      >
        {loading ? (
          <span
            className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden
          />
        ) : null}
        {children}
      </motion.button>
    );
  },
);

interface IconButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  label: string;
  children: ReactNode;
}

export function IconButton({
  label,
  children,
  className = "",
  ...rest
}: IconButtonProps): ReactNode {
  return (
    <motion.button
      type="button"
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.9 }}
      transition={{ type: "spring", stiffness: 500, damping: 24 }}
      aria-label={label}
      title={label}
      className={`inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-card hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${className}`}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
