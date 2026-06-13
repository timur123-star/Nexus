import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../lib/utils";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A fully custom (non-native) dropdown that matches the NexusShield dark theme.
 * Replaces native <select> so the option list is themed instead of using the
 * OS-rendered popup. The panel is portaled to <body> and positioned under the
 * trigger so it never gets clipped by a scroll container.
 */
export function CustomSelect<T extends string>({
  value,
  options,
  onChange,
  className,
  align = "left",
  buttonClassName,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  className?: string;
  align?: "left" | "right";
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const el = btnRef.current;
      if (el) setRect(el.getBoundingClientRect());
    };
    update();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      const panel = document.getElementById(`${id}-panel`);
      if (panel?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, id]);

  return (
    <div className={cn("relative", className)}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "ns-input flex w-full items-center justify-between gap-2 text-left",
          buttonClassName,
        )}
      >
        <span className="truncate">{current?.label ?? value}</span>
        <ChevronDown
          size={15}
          className={cn("shrink-0 text-text-faint transition-transform", open && "rotate-180")}
        />
      </button>
      {createPortal(
        <AnimatePresence>
          {open && rect && (
            <motion.div
              id={`${id}-panel`}
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.14, ease: "easeOut" }}
              style={{
                position: "fixed",
                top: rect.bottom + 6,
                left: align === "right" ? undefined : rect.left,
                right: align === "right" ? window.innerWidth - rect.right : undefined,
                minWidth: rect.width,
                zIndex: 90,
              }}
              className="glass-elev max-h-64 overflow-auto rounded-card border border-border/70 p-1.5 shadow-2xl"
            >
              {options.map((o) => {
                const selected = o.value === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-btn px-2.5 py-2 text-left text-sm transition-colors",
                      selected
                        ? "bg-indigo/15 text-indigo"
                        : "text-text-dim hover:bg-surface hover:text-text",
                    )}
                  >
                    <span className="truncate">{o.label}</span>
                    {selected && <Check size={14} className="shrink-0" />}
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
