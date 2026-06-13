import { create } from "zustand";

export type ToastKind = "info" | "success" | "error" | "warning";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  /** Auto-dismiss delay in ms. Use 0 to keep until dismissed manually. */
  duration: number;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: { kind?: ToastKind; message: string; duration?: number }) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

let counter = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: ({ kind = "info", message, duration = 3800 }) => {
    const id = ++counter;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message, duration }].slice(-4) }));
    if (duration > 0 && typeof window !== "undefined") {
      window.setTimeout(() => get().dismiss(id), duration);
    }
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/**
 * Imperative helper for firing toasts from non-React code (stores, IPC
 * callbacks, etc.). Inside components you can also use the store directly.
 */
export const toast = {
  info: (message: string, duration?: number) =>
    useToastStore.getState().push({ kind: "info", message, duration }),
  success: (message: string, duration?: number) =>
    useToastStore.getState().push({ kind: "success", message, duration }),
  error: (message: string, duration?: number) =>
    useToastStore.getState().push({ kind: "error", message, duration }),
  warning: (message: string, duration?: number) =>
    useToastStore.getState().push({ kind: "warning", message, duration }),
};
