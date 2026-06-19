import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "flag-icons/css/flag-icons.min.css";
import { useSettingsStore } from "./store/useSettingsStore";
import { ErrorBoundary } from "./shared/components/ErrorBoundary";

/**
 * Last-resort global handlers. Without these, a rejected promise from any of the
 * many fire-and-forget IPC calls vanishes silently in production, and an
 * uncaught error outside the per-screen boundaries blanks the window. We log
 * them to the console (visible in the webview devtools / captured by the harness)
 * so field failures are diagnosable.
 */
window.addEventListener("unhandledrejection", (e) => {
  // eslint-disable-next-line no-console
  console.error("[NexusShield] Unhandled promise rejection:", e.reason);
});
window.addEventListener("error", (e) => {
  // eslint-disable-next-line no-console
  console.error("[NexusShield] Uncaught error:", e.error ?? e.message);
});

/** Apply the persisted theme to <html> before first paint. */
function applyTheme() {
  const { theme } = useSettingsStore.getState().app;
  const root = document.documentElement;
  const wantDark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", wantDark);
  root.classList.toggle("light", !wantDark);
}

applyTheme();
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
useSettingsStore.subscribe(applyTheme);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {/* Top-level boundary so a crash OUTSIDE the per-screen boundaries (titlebar,
        sidebar, toaster, background) shows a recoverable fallback instead of a
        blank window. */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
