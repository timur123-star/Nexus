import { AnimatePresence, motion } from "framer-motion";
import { Power } from "lucide-react";
import { cn } from "../lib/utils";
import { EASE_OUT, prefersReducedMotion } from "../lib/motion";

export type ConnectButtonState = "connected" | "busy" | "idle";

const ringInitial = { scale: 0.85, opacity: 0.6 };
const ringAnimate = { scale: 1.9, opacity: 0 };
const ringExit = { opacity: 0 };
const ringTransition = (delay: number) => ({
  duration: 1.8,
  ease: EASE_OUT,
  repeat: Infinity,
  delay,
});
const btnTransition = { duration: 0.3, ease: EASE_OUT };
const tapScale = { scale: 0.94 };
const hoverScale = { scale: 1.05 };

/**
 * Large circular connect/disconnect control.
 *
 * - Idle: indigo gradient, lifts on hover.
 * - Connected: teal gradient with two expanding "sonar" pulse rings.
 * - Busy (connecting/reconnecting): the power glyph spins.
 *
 * All motion is disabled when the OS requests reduced motion.
 */
export function ConnectButton({
  state,
  onClick,
  labels,
}: {
  state: ConnectButtonState;
  onClick: () => void;
  labels: { connected: string; busy: string; idle: string };
}) {
  const connected = state === "connected";
  const busy = state === "busy";
  const reduce = prefersReducedMotion();
  const label = connected ? labels.connected : busy ? labels.busy : labels.idle;

  const btnAnimate = {
    boxShadow: connected
      ? "0 14px 44px -8px rgba(30, 200, 164, 0.45)"
      : "0 14px 44px -8px rgba(91, 106, 240, 0.45)",
  };
  const spinAnimate = busy && !reduce ? { rotate: 360 } : { rotate: 0 };
  const spinTransition =
    busy && !reduce
      ? { duration: 1, ease: "linear" as const, repeat: Infinity }
      : { duration: 0.2 };

  return (
    <div className="relative grid place-items-center">
      <AnimatePresence>
        {connected &&
          !reduce &&
          [0, 0.6].map((delay) => (
            <motion.span
              key={delay}
              className="pointer-events-none absolute h-28 w-28 rounded-full bg-ok/30"
              initial={ringInitial}
              animate={ringAnimate}
              exit={ringExit}
              transition={ringTransition(delay)}
            />
          ))}
      </AnimatePresence>

      <motion.button
        onClick={onClick}
        disabled={busy}
        whileTap={reduce ? undefined : tapScale}
        whileHover={reduce || connected ? undefined : hoverScale}
        animate={btnAnimate}
        transition={btnTransition}
        className={cn(
          "relative grid h-28 w-28 place-items-center rounded-full text-white transition-colors duration-300 disabled:opacity-70",
          connected
            ? "bg-gradient-to-br from-ok to-teal"
            : "bg-gradient-to-br from-indigo to-indigo-soft",
        )}
      >
        <div className="flex flex-col items-center gap-1">
          <motion.span animate={spinAnimate} transition={spinTransition}>
            <Power size={30} />
          </motion.span>
          <span className="text-xs font-medium">{label}</span>
        </div>
      </motion.button>
    </div>
  );
}
