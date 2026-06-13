import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";
import { useToastStore, type ToastKind } from "../../store/useToastStore";
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

// Motion values kept as consts (single-brace JSX) for consistency with the
// rest of the codebase.
const toastInitial = { opacity: 0, x: 36, scale: 0.96 };
const toastAnimate = { opacity: 1, x: 0, scale: 1 };
const toastExit = { opacity: 0, x: 36, scale: 0.96 };
const toastTransition = { duration: 0.26, ease: EASE_OUT };

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
        {toasts.map((t) => {
          const Icon = ICON[t.kind];
          return (
            <motion.div
              key={t.id}
              layout
              initial={toastInitial}
              animate={toastAnimate}
              exit={toastExit}
              transition={toastTransition}
              className="glass-elev pointer-events-auto flex items-start gap-2.5 rounded-card px-3.5 py-3"
            >
              <Icon size={18} className={`${ACCENT[t.kind]} mt-0.5 shrink-0`} />
              <p className="flex-1 text-xs leading-relaxed text-text">{t.message}</p>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="dismiss"
                className="shrink-0 text-text-faint transition-colors hover:text-text"
              >
                <X size={14} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
