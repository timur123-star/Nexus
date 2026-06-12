import { AnimatePresence, motion } from "framer-motion";
import { Power } from "lucide-react";
import { cn } from "../lib/utils";
import { EASE_OUT, prefersReducedMotion } from "../lib/motion";

export type ConnectButtonState = "connected" | "busy" | "idle";

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

  return (
    <div className="relative grid place-items-center">
      <AnimatePresence>
        {connected &&
          !reduce &&
          [0, 0.6].map((delay) => (
            <motion.span
              key={delay}
              className="pointer-events-none absolute h-28 w-28 rounded-full bg-ok/30"
              initial= scale: 0.85, opacity: 0.6 
              animate= scale: 1.9, opacity: 0 
              exit= opacity: 0 
              transition= duration: 1.8, ease: EASE_OUT, repeat: Infinity, delay 
            />
          ))}
      </AnimatePresence>

      <motion.button
        onClick={onClick}
        disabled={busy}
        whileTap={reduce ? undefined : { scale: 0.94 }}
        whileHover={reduce || connected ? undefined : { scale: 1.05 }}
        animate=
          boxShadow: connected
            ? "0 14px 44px -8px rgba(30, 200, 164, 0.45)"
            : "0 14px 44px -8px rgba(91, 106, 240, 0.45)",
        
        transition= duration: 0.3, ease: EASE_OUT 
        className={cn(
          "relative grid h-28 w-28 place-items-center rounded-full text-white transition-colors duration-300 disabled:opacity-70",
          connected
            ? "bg-gradient-to-br from-ok to-teal"
            : "bg-gradient-to-br from-indigo to-indigo-soft",
        )}
      >
        <div className="flex flex-col items-center gap-1">
          <motion.span
            animate={busy && !reduce ? { rotate: 360 } : { rotate: 0 }}
            transition={
              busy && !reduce
                ? { duration: 1, ease: "linear", repeat: Infinity }
                : { duration: 0.2 }
            }
          >
            <Power size={30} />
          </motion.span>
          <span className="text-xs font-medium">{label}</span>
        </div>
      </motion.button>
    </div>
  );
}
