/**
 * Shared Framer Motion primitives.
 *
 * Centralising variants/transitions keeps motion consistent (200-300ms,
 * ease-out as per the design spec) and makes it trivial to honour the user's
 * OS-level "reduce motion" preference.
 */
import type { Transition, Variants } from "framer-motion";

/** ease-out curve from the design system (matches --ease-out in index.css). */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** A soft spring used for layout / width / position transitions. */
export const springSoft: Transition = {
  type: "spring",
  stiffness: 320,
  damping: 30,
  mass: 0.8,
};

/** True when the OS requests reduced motion. Safe to call during render. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Screen-to-screen transition for the main content area. */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  enter: { opacity: 1, y: 0, transition: { duration: 0.25, ease: EASE_OUT } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.18, ease: EASE_OUT } },
};

/** Staggered fade-in-up for lists/cards. Pass the index via `custom`. */
export const fadeInUp: Variants = {
  initial: { opacity: 0, y: 12 },
  enter: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: EASE_OUT, delay: i * 0.05 },
  }),
};
