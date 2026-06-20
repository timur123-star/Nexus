import { AnimatePresence, motion } from "framer-motion";
import { cn } from "../lib/utils";
import { prefersReducedMotion } from "../lib/motion";
import emblemGrey from "../../assets/emblem-grey.png";
import emblemRed from "../../assets/emblem-red.png";

export type ShieldState = "connected" | "busy" | "idle";

/**
 * The hero connect control — Timur's NexusShield emblem with its nameplate.
 *
 * Two pre-rendered artworks supplied by Timur (steel-grey + crimson) are
 * stacked and cross-faded so the emblem goes 1-to-1 from his reference:
 *  - Idle      → steel-grey emblem, dim.
 *  - Busy      → the crimson artwork pulses up as it "charges".
 *  - Connected → full crimson with a red glow, rotating halo + sonar rings.
 *
 * The current connection state (Подключение / Подключено / Отключено) is
 * printed straight onto the emblem's nameplate so it reads like the mockup.
 */

// The artwork's empty nameplate band, as a fraction of the rendered emblem box.
// Used to place the status caption exactly inside the plate.
const PLATE = { top: "79%", bottom: "6.5%", left: "14%", right: "14%" } as const;

const floatAnimate = { y: [0, -6, 0] };
const floatTransition = { duration: 4.5, ease: "easeInOut" as const, repeat: Infinity };

const busyPulse = { opacity: [0.55, 1, 0.55] };
const busyTransition = { duration: 1.2, ease: "easeInOut" as const, repeat: Infinity };

const haloStyle: React.CSSProperties = {
  background:
    "conic-gradient(from 0deg, transparent 0deg, rgba(239,68,68,0) 40deg, rgba(220,38,38,0.55) 120deg, rgba(239,68,68,0) 210deg, transparent 360deg)",
  WebkitMaskImage: "radial-gradient(closest-side, transparent 60%, #000 63%, #000 100%)",
  maskImage: "radial-gradient(closest-side, transparent 60%, #000 63%, #000 100%)",
};
const haloAnimate = { rotate: 360 };
const haloTransition = { duration: 7, ease: "linear" as const, repeat: Infinity };

const ringInitial = { scale: 0.74, opacity: 0.5 };
const ringAnimate = { scale: 1.55, opacity: 0 };
const ringTransition = (delay: number) => ({ duration: 2.2, ease: [0.16, 1, 0.3, 1] as const, repeat: Infinity, delay });

const idleGlow = { opacity: [0.16, 0.28, 0.16], scale: [1, 1.05, 1] };
const idleGlowTransition = { duration: 3.6, ease: "easeInOut" as const, repeat: Infinity };
const onGlow = { opacity: [0.45, 0.78, 0.45], scale: [1, 1.07, 1] };
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
  // How "lit" the crimson artwork is: 0 idle → ~0.85 busy → 1 connected.
  const redOpacity = connected ? 1 : busy ? 0.85 : 0;

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Never disabled — while "busy" a tap CANCELS the in-flight connect, so a
          crash-looping core can always be stopped instead of stranding the user
          on an endless "connecting". */}
      <motion.button
        type="button"
        onClick={onClick}
        whileHover={reduce ? undefined : { scale: 1.03 }}
        whileTap={reduce ? undefined : { scale: 0.96 }}
        className="relative grid cursor-pointer place-items-center rounded-2xl focus:outline-none"
        style={{ width: 248, height: 261 }}
        aria-label={label}
      >
        {/* Ambient glow behind the emblem. */}
        <motion.span
          aria-hidden
          className={cn(
            "pointer-events-none absolute h-44 w-44 rounded-full blur-2xl",
            connected ? "bg-indigo/45" : busy ? "bg-indigo/25" : "bg-slate-500/15",
          )}
          style={{ top: "30%" }}
          animate={reduce ? { opacity: connected ? 0.55 : 0.2 } : connected ? onGlow : idleGlow}
          transition={reduce ? { duration: 0.4 } : connected ? onGlowTransition : idleGlowTransition}
        />

        {/* Rotating energy halo around the emblem ring (connected). */}
        {connected && !reduce && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute h-56 w-56 rounded-full"
            style={{ ...haloStyle, top: "8%" }}
            animate={haloAnimate}
            transition={haloTransition}
          />
        )}

        {/* Sonar rings (connected). */}
        <AnimatePresence>
          {connected &&
            !reduce &&
            [0, 0.9].map((d) => (
              <motion.span
                key={d}
                aria-hidden
                className="pointer-events-none absolute h-52 w-52 rounded-full border border-indigo/40"
                style={{ top: "10%" }}
                initial={ringInitial}
                animate={ringAnimate}
                exit={{ opacity: 0 }}
                transition={ringTransition(d)}
              />
            ))}
        </AnimatePresence>

        {/* Emblem artwork: grey base + crimson cross-fade. */}
        <motion.div
          className="relative h-full w-full"
          animate={reduce ? {} : busy ? busyPulse : !connected ? floatAnimate : {}}
          transition={
            reduce ? { duration: 0.4 } : busy ? busyTransition : !connected ? floatTransition : { duration: 0.4 }
          }
        >
          <img
            src={emblemGrey}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full select-none object-contain"
            style={{ filter: "drop-shadow(0 8px 18px rgba(0,0,0,0.6))" }}
          />
          <img
            src={emblemRed}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full select-none object-contain"
            style={{
              opacity: redOpacity,
              filter: "drop-shadow(0 0 30px rgba(220,38,38,0.55))",
              transition: "opacity 1.1s cubic-bezier(0.16,1,0.3,1)",
            }}
          />

          {/* Status caption printed inside the emblem's nameplate. */}
          <div
            className="pointer-events-none absolute flex items-center justify-center"
            style={{ top: PLATE.top, bottom: PLATE.bottom, left: PLATE.left, right: PLATE.right }}
          >
            <motion.span
              key={label}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className={cn(
                "select-none whitespace-nowrap text-[15px] font-semibold uppercase tracking-[0.16em]",
                connected ? "text-white" : busy ? "text-red-100" : "text-slate-200",
              )}
              style={
                connected
                  ? { textShadow: "0 0 12px rgba(239,68,68,0.85), 0 1px 2px rgba(0,0,0,0.8)" }
                  : { textShadow: "0 1px 3px rgba(0,0,0,0.85)" }
              }
            >
              {label}
            </motion.span>
          </div>
        </motion.div>
      </motion.button>

      {/* Sub-caption (uptime / hint) below the emblem. */}
      {sublabel && (
        <motion.span
          key={sublabel}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className={cn("font-mono text-sm", connected ? "text-indigo-soft" : "text-text-dim")}
        >
          {sublabel}
        </motion.span>
      )}
    </div>
  );
}
