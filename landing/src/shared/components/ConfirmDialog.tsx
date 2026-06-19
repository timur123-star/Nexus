import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { TriangleAlert } from "lucide-react";

interface Props {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Style the confirm button as destructive (red). */
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Accessible confirmation dialog for destructive actions (delete subscription +
 * its servers, clear logs/history, …). Provides a focus trap, Escape-to-cancel,
 * backdrop dismissal, focus restoration, and the proper ARIA roles so it is
 * keyboard- and screen-reader-friendly.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger,
  onConfirm,
  onClose,
}: Props) {
  const titleId = useId();
  const bodyId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Remember what had focus so we can restore it on close.
    restoreRef.current = document.activeElement as HTMLElement | null;
    // Move focus into the dialog (the confirm button).
    const id = requestAnimationFrame(() => confirmRef.current?.focus());

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab") {
        // Simple focus trap across the dialog's focusable elements.
        const root = dialogRef.current;
        if (!root) return;
        const focusable = root.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(id);
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="glass flex w-full max-w-sm flex-col gap-4 rounded-card p-6"
      >
        <div className="flex items-start gap-3">
          <div
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-btn ${
              danger ? "bg-bad/15 text-bad" : "bg-indigo/15 text-indigo"
            }`}
          >
            <TriangleAlert size={20} />
          </div>
          <div className="space-y-1.5">
            <h2 id={titleId} className="text-base font-semibold text-text">
              {title}
            </h2>
            <p id={bodyId} className="text-[13px] leading-relaxed text-text-dim">
              {body}
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-btn border border-border px-4 py-2 text-xs font-medium text-text-dim transition-colors hover:bg-surface/60"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`rounded-btn px-4 py-2 text-xs font-semibold transition-colors ${
              danger
                ? "bg-bad/15 text-bad hover:bg-bad/25"
                : "bg-indigo/15 text-indigo hover:bg-indigo/25"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
