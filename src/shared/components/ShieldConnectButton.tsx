import { AnimatePresence, motion } from "framer-motion";
import { cn } from "../lib/utils";
import { prefersReducedMotion } from "../lib/motion";
import shield from "../../assets/shield-emblem.png";

export type ShieldState = "connected" | "busy" | "idle";

/**
 * The hero connect control — the NexusShield emblem itself.
 *
 *  - Idle      → steel-grey (desaturated), gently floating, dim halo.
 *  - Busy      → warming up: a red charge pulses through the emblem.
 *  - Connected → full crimson, drop-shadow glow, rotating energy halo and
 *    expanding "sonar" rings.
 *
 * Grey→red is a single animated `filter` on the emblem image, giving the
 * aggressive colour-surge the brief asks for without swapping artwork.
 */

const SHIELD_STATE = {
  idle: { filter: "grayscale(1) brightness(0.7) contrast(1.05) drop-shadow(0 6px 16px rgba(0,0,0,0.6))" },
  busy: { filter: "grayscale(0.4) brightness(0.9) contrast(1.05) drop-shadow(0 0 22px rgba(220,38,38,0.4))" },
  connected: { filter: "grayscale(0) brightness(1.08) saturate(1.25) drop-shadow(0 0 34px rgba(220,38,38,0.65))" },
} as const;
const shieldTransition = { duration: 1.1, ease: [0.16, 1, 0.3, 1] as const };

const floatAnimate = { y: [0, -7, 0] };
const floatTransition = { duration: 4.5, ease: "easeInOut" as const, repeat: Infinity };

const busyPulse = { opacity: [0.5, 1, 0.5], scale: [1, 1.03, 1] };
const busyTransition = { duration: 1.1, ease: "easeInOut" as const, repeat: Infinity };

const haloStyle: React.CSSProperties = {
  background:
    "conic-gradient(from 0deg, transparent 0deg, rgba(239,68,68,0) 40deg, rgba(220,38,38,0.5) 120deg, rgba(239,68,68,0) 210deg, transparent 360deg)",
  WebkitMaskImage: "radial-gradient(closest-side, transparent 58%, #000 61%, #000 100%)",
  maskImage: "radial-gradient(closest-side, transparent 58%, #000 61%, #000 100%)",
};
const haloAnimate = { rotate: 360 };
const haloTransition = { duration: 7, ease: "linear" as const, repeat: Infinity };

const ringInitial = { scale: 0.7, opacity: 0.5 };
const ringAnimate = { scale: 1.7, opacity: 0 };
const ringTransition = (delay: number) => ({ duration: 2, ease: [0.16, 1, 0.3, 1] as const, repeat: Infinity, delay });

const idleGlow = { opacity: [0.18, 0.32, 0.18], scale: [1, 1.06, 1] };
const idleGlowTransition = { duration: 3.4, ease: "easeInOut" as const, repeat: Infinity };
const onGlow = { opacity: [0.45, 0.75, 0.45], scale: [1, 1.08, 1] };
const onGlowTransition = { duration: 3, ease: "easeInOut" as const, repeat: Infinity };

export function ShieldConnectButton({
  state,
  onClick,
  label,
  sublabel,
}: {
  state: ShieldState;
  onClick: () => void;
  label: string;
  sublabel?: string;
}) {
  const reduce = prefersReducedMotion();
  const connected = state === "connected";
  const busy = state === "busy";

  return (
    <div className="flex flex-col items-center gap-5">
      <motion.button
        type="button"
        onClick={onClick}
        disabled={busy}
        whileHover={reduce || busy ? undefined : { scale: 1.04 }}
        whileTap={reduce || busy ? undefined : { scale: 0.95 }}
        className="relative grid h-56 w-56 place-items-center rounded-full focus:outline-none disabled:cursor-wait"
        aria-label={label}
      >
        {/* Ambient glow behind the emblem. */}
        <motion.span
          aria-hidden
          className={cn(
            "pointer-events-none absolute h-44 w-44 rounded-full blur-2xl",
            connected ? "bg-indigo/40" : "bg-slate-500/20",
          )}
          animate={reduce ? { opacity: connected ? 0.5 : 0.2 } : connected ? onGlow : idleGlow}
          transition={reduce ? { duration: 0.4 } : connected ? onGlowTransition : idleGlowTransition}
        />

        {/* Rotating energy halo (connected). */}
        {connected && !reduce && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute h-52 w-52 rounded-full"
            style={haloStyle}
            animate={haloAnimate}
            transition={haloTransition}
          />
        )}

        {/* Sonar rings (connected). */}
        <AnimatePresence>
          {connected &&
            !reduce &&
            [0, 0.7].map((d) => (
              <motion.span
                key={d}
                aria-hidden
                className="pointer-events-none absolute h-44 w-44 rounded-full border border-indigo/40"
                initial={ringInitial}
                animate={ringAnimate}
                exit={{ opacity: 0 }}
                transition={ringTransition(d)}
              />
            ))}
        </AnimatePresence>

        {/* The emblem — colour-shifts grey→crimson via animated filter. */}
        <motion.img
          src={shield}
          alt=""
          draggable={false}
          className="relative z-[1] h-44 w-auto select-none"
          animate={{
            ...SHIELD_STATE[state],
            ...(reduce ? {} : busy ? busyPulse : !connected ? floatAnimate : {}),
          }}
          transition={
            reduce
              ? shieldTransition
              : busy
                ? { ...shieldTransition, ...busyTransition }
                : !connected
                  ? { ...shieldTransition, ...floatTransition }
                  : shieldTransition
          }
        />
      </motion.button>

      {/* Label block. */}
      <div className="flex flex-col items-center gap-1">
        <motion.span
          key={label}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className={cn(
            "text-2xl font-bold uppercase tracking-[0.18em]",
            connected ? "text-indigo-soft" : busy ? "text-warn" : "text-text-dim",
          )}
          style={connected ? { textShadow: "0 0 22px rgba(220,38,38,0.6)" } : undefined}
        >
          {label}
        </motion.span>
        {sublabel && <span className="font-mono text-sm text-text-dim">{sublabel}</span>}
      </div>
    </div>
  );
}
