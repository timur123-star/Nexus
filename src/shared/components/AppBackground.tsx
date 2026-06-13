import { AnimatePresence, motion } from "framer-motion";
import { useConnectionStore } from "../../store/useConnectionStore";
import { prefersReducedMotion } from "../lib/motion";
import worldMap from "../../assets/world-map.png";

/**
 * App-wide living backdrop: a world map that reflects the VPN state.
 *
 *  - Disconnected / error → the map is desaturated steel-grey and dim.
 *  - Connecting           → it warms up, a red charge sweeping in.
 *  - Connected            → it ignites into the brand crimson with a one-shot
 *    "surge" flash + a breathing red glow.
 *
 * The grey→red shift is a single animated `filter` on one image, so the map
 * stays perfectly registered while it changes colour (no crossfade ghosting).
 * Shared by every screen, which keeps the whole app visually 1-to-1.
 */

// Visual presets per phase. brightness/saturate drive the grey↔red colour.
const MAP_STATE = {
  off: { filter: "grayscale(1) brightness(0.55) contrast(1.08)", opacity: 0.34, scale: 1 },
  charging: { filter: "grayscale(0.45) brightness(0.82) saturate(1.1)", opacity: 0.5, scale: 1.03 },
  on: { filter: "grayscale(0) brightness(1.08) saturate(1.35) contrast(1.05)", opacity: 0.62, scale: 1.06 },
} as const;

const mapTransition = { duration: 1.4, ease: [0.16, 1, 0.3, 1] as const };

// Soft breathing of the red glow wash once connected.
const glowOn = { opacity: [0.35, 0.6, 0.35] };
const glowTransition = { duration: 5, ease: "easeInOut" as const, repeat: Infinity };

// One-shot ignition flash, re-fired on every fresh connection.
const surgeInitial = { opacity: 0.55, scale: 0.6 };
const surgeAnimate = { opacity: 0, scale: 1.8 };
const surgeTransition = { duration: 0.9, ease: [0.16, 1, 0.3, 1] as const };

export function AppBackground() {
  const status = useConnectionStore((s) => s.status);
  const connectedAt = useConnectionStore((s) => s.connectedAt);
  const reduce = prefersReducedMotion();

  const connected = status === "connected";
  const busy = status === "connecting" || status === "reconnecting";
  const phase = connected ? "on" : busy ? "charging" : "off";
  const map = MAP_STATE[phase];

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* World map — the colour-shifting hero layer. */}
      <motion.img
        src={worldMap}
        alt=""
        className="absolute left-1/2 top-0 w-[185%] max-w-none -translate-x-1/2 select-none object-cover md:w-[150%]"
        style={{ maskImage: "linear-gradient(to bottom, #000 0%, #000 66%, transparent 97%)", WebkitMaskImage: "linear-gradient(to bottom, #000 0%, #000 66%, transparent 97%)" }}
        animate={reduce ? { opacity: map.opacity } : map}
        transition={mapTransition}
      />

      {/* Crimson glow wash — fades up when connected and breathes. */}
      <motion.div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(80vw 60vh at 50% 20%, rgba(220,38,38,0.22), transparent 60%), radial-gradient(60vw 40vh at 50% 0%, rgba(239,68,68,0.16), transparent 55%)",
        }}
        animate={connected ? (reduce ? { opacity: 0.5 } : glowOn) : { opacity: 0 }}
        transition={connected && !reduce ? glowTransition : { duration: 1.2 }}
      />

      {/* Cool steel wash while disconnected — subtle, keeps the "off" feel. */}
      <motion.div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(70vw 50vh at 50% 12%, rgba(120,130,150,0.10), transparent 60%)",
        }}
        animate={{ opacity: connected || busy ? 0 : 1 }}
        transition={{ duration: 1.2 }}
      />

      {/* Ignition flash — remounts on each new connection via connectedAt key. */}
      <AnimatePresence>
        {connected && !reduce && (
          <motion.div
            key={connectedAt ?? "on"}
            className="absolute left-1/2 top-[18%] h-[60vh] w-[60vh] -translate-x-1/2 rounded-full"
            style={{
              background:
                "radial-gradient(circle, rgba(239,68,68,0.55) 0%, rgba(220,38,38,0.25) 40%, transparent 70%)",
            }}
            initial={surgeInitial}
            animate={surgeAnimate}
            exit={{ opacity: 0 }}
            transition={surgeTransition}
          />
        )}
      </AnimatePresence>

      {/* Bottom + edge vignette so foreground content stays legible. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, transparent 30%, rgba(5,5,6,0.55) 78%, rgba(5,5,6,0.9) 100%)",
        }}
      />
    </div>
  );
}
