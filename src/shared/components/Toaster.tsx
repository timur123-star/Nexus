import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";
import { useToastStore, type Toast, type ToastKind } from "../../store/useToastStore";
import { EASE_OUT } from "../lib/motion";

const ICON: Record<ToastKind, React.ElementType> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const ACCENT: Record<ToastKind, string> = {
  success: "text-ok",
  error: "text-bad",
  warning: "text-warn",
  info: "text-indigo-soft",
};

// Solid fills for the countdown bar, matched to each kind's accent icon.
const BAR: Record<ToastKind, string> = {
  success: "bg-ok",
  error: "bg-bad",
  warning: "bg-warn",
  info: "bg-indigo",
};

// Motion values kept as consts (single-brace JSX) for consistency with the
// rest of the codebase.
const toastInitial = { opacity: 0, x: 36, scale: 0.96 };
const toastAnimate = { opacity: 1, x: 0, scale: 1 };
const toastExit = { opacity: 0, x: 36, scale: 0.96 };
const toastTransition = { duration: 0.26, ease: EASE_OUT };
const barInitial = { scaleX: 1 };
const barAnimate = { scaleX: 0 };

/**
 * Bottom-right stack of transient notifications. Cards use the elevated glass
 * surface, slide in from the right, and auto-dismiss (see useToastStore). The
 * container is pointer-events-none so it never blocks the UI; only the cards
 * themselves are interactive.
 */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-80 max-w-[calc(100vw-2.5rem)] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastCard({ toast: t, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon = ICON[t.kind];
  // Pause the visual countdown while the pointer is over the card. The store's
  // own timer keeps running, so this is purely a hint that mirrors intent
  // without desyncing — short, honest, and cheap.
  const [paused, setPaused] = useState(false);
  const startRef = useRef(Date.now());
  const showBar = t.duration > 0;
  // Account for time already elapsed so a re-render mid-life resumes correctly.
  const remaining = Math.max(0, t.duration - (Date.now() - startRef.current)) / 1000;

  return (
    <motion.div
      layout
      initial={toastInitial}
      animate={toastAnimate}
      exit={toastExit}
      transition={toastTransition}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="glass-elev pointer-events-auto relative flex items-start gap-2.5 overflow-hidden rounded-card px-3.5 py-3"
    >
      <Icon size={18} className={`${ACCENT[t.kind]} mt-0.5 shrink-0`} />
      <p className="flex-1 text-xs leading-relaxed text-text">{t.message}</p>
      <button
        onClick={onDismiss}
        aria-label="dismiss"
        className="shrink-0 text-text-faint transition-colors hover:text-text"
      >
        <X size={14} />
      </button>
      {showBar && (
        <motion.div
          aria-hidden
          className={`absolute inset-x-0 bottom-0 h-0.5 origin-left ${BAR[t.kind]}/70`}
          initial={barInitial}
          animate={paused ? barInitial : barAnimate}
          transition={ { duration: paused ? 0 : remaining, ease: "linear" } }
        />
      )}
    </motion.div>
  );
}
