import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "flag-icons/css/flag-icons.min.css";
import { useSettingsStore } from "./store/useSettingsStore";

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
    <App />
  </React.StrictMode>,
);
