import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "flag-icons/css/flag-icons.min.css";
import { useSettingsStore } from "./store/useSettingsStore";
import { ErrorBoundary } from "./shared/components/ErrorBoundary";

// Last-resort fallback labels for a crash ABOVE the per-screen boundary (in the
// title bar, sidebar, background, onboarding, etc.). Without a root boundary
// such a render error unmounts the whole tree and leaves a blank window — the
// "интерфейс внутренний исчезает" report. Kept inline so the i18n parity test
// stays untouched.
const ROOT_BOUNDARY_LABELS: Record<"ru" | "en" | "fa" | "zh", { title: string; body: string; retry: string }> = {
  ru: {
    title: "Что-то пошло не так",
    body: "Произошла непредвиденная ошибка. Нажмите, чтобы перезагрузить интерфейс — соединение не прерывается.",
    retry: "Перезагрузить интерфейс",
  },
  en: {
    title: "Something went wrong",
    body: "The app hit an unexpected error. Reload the interface to recover — your connection isn't interrupted.",
    retry: "Reload interface",
  },
  fa: {
    title: "مشکلی پیش آمد",
    body: "برنامه با خطای غیرمنتظره مواجه شد. برای بازیابی، رابط را بارگذاری مجدد کنید — اتصال شما قطع نمی‌شود.",
    retry: "بارگذاری مجدد رابط",
  },
  zh: {
    title: "出了点问题",
    body: "应用遇到意外错误。重新加载界面即可恢复——连接不会中断。",
    retry: "重新加载界面",
  },
};

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

/** App wrapped in a top-level ErrorBoundary whose labels follow the UI language. */
function Root() {
  const language = useSettingsStore((s) => s.app.language);
  return (
    <ErrorBoundary labels={ROOT_BOUNDARY_LABELS[language] ?? ROOT_BOUNDARY_LABELS.en}>
      <App />
    </ErrorBoundary>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
