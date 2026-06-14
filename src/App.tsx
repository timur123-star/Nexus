import { useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "framer-motion";
import { TitleBar } from "./shared/components/TitleBar";
import { AppBackground } from "./shared/components/AppBackground";
import { Sidebar, type Screen } from "./shared/components/Sidebar";
import { Toaster } from "./shared/components/Toaster";
import { ConnectionScreen } from "./features/connection/ConnectionScreen";
import { ServersScreen } from "./features/servers/ServersScreen";
import { StatsScreen } from "./features/stats/StatsScreen";
import { HistoryScreen } from "./features/history/HistoryScreen";
import { LogsScreen } from "./features/logs/LogsScreen";
import { SettingsScreen } from "./features/settings/SettingsScreen";
import { EditorScreen } from "./features/editor/EditorScreen";
import { ImportDialog } from "./features/import/ImportDialog";
import { CommandPalette } from "./shared/components/CommandPalette";
import { ErrorBoundary } from "./shared/components/ErrorBoundary";
import { Onboarding } from "./features/onboarding/Onboarding";
import { useCoreEvents } from "./shared/hooks/useCoreEvents";
import { useTrafficPoller } from "./shared/hooks/useTrafficPoller";
import { useHealthMonitor } from "./shared/hooks/useHealthMonitor";
import { useCoreNotices } from "./shared/hooks/useCoreNotices";
import { useConnectionToasts } from "./shared/hooks/useConnectionToasts";
import { useSessionHistory } from "./shared/hooks/useSessionHistory";
import { isTauri } from "./core/ipc";
import { useServerStore } from "./store/useServerStore";
import { useConnectionStore } from "./store/useConnectionStore";
import { useSettingsStore } from "./store/useSettingsStore";
import { startSubscriptionScheduler } from "./core/subscriptions/scheduler";
import { parseDeepLink } from "./core/deeplink";
import { toast } from "./store/useToastStore";
import { pageVariants } from "./shared/lib/motion";
import { applyAccent } from "./shared/lib/accents";

// Screen-local toasts for deep-link imports — kept out of the global i18n
// dictionary so they never affect the key-parity test.
const DEEPLINK_MSG: Record<"ru" | "en" | "fa" | "zh", (n: number) => string> = {
  ru: (n) => `Импортировано из ссылки: ${n} сервер(ов)`,
  en: (n) => `Imported from link: ${n} server(s)`,
  fa: (n) => `از لینک وارد شد: ${n} سرور`,
  zh: (n) => `已从链接导入：${n} 个服务器`,
};

// Localized fallback shown by the screen-level ErrorBoundary so a crashing
// screen never blanks the whole window.
const BOUNDARY_LABELS: Record<
  "ru" | "en" | "fa" | "zh",
  { title: string; body: string; retry: string }
> = {
  ru: {
    title: "Что-то пошло не так",
    body: "Этот экран столкнулся с непредвиденной ошибкой. Приложение работает — можно повторить или перейти на другой экран.",
    retry: "Перезагрузить экран",
  },
  en: {
    title: "Something went wrong",
    body: "This screen hit an unexpected error. The app is still running — retry or switch screens.",
    retry: "Reload screen",
  },
  fa: {
    title: "مشکلی پیش آمد",
    body: "این صفحه با خطای غیرمنتظره مواجه شد. برنامه همچنان در حال اجراست — دوباره تلاش کنید یا صفحه را عوض کنید.",
    retry: "بارگذاری مجدد صفحه",
  },
  zh: {
    title: "出了点问题",
    body: "此屏幕遇到意外错误。应用仍在运行——可重试或切换到其他屏幕。",
    retry: "重新加载屏幕",
  },
};

export default function App() {
  const [screen, setScreen] = useState<Screen>("connection");
  const [importOpen, setImportOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const servers = useServerStore((s) => s.servers);
  const theme = useSettingsStore((s) => s.app.theme);
  const accent = useSettingsStore((s) => s.app.accent);
  const language = useSettingsStore((s) => s.app.language);
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem("ns-onboarded") === "1");

  useCoreEvents();
  useTrafficPoller();
  useHealthMonitor();
  useCoreNotices();
  useConnectionToasts();
  useSessionHistory();

  // Apply the chosen theme to the document root. The light palette lives under
  // `:root.light` in index.css, so without this the selector in Settings did
  // nothing. In "system" mode we follow (and keep following) the OS preference.
  useEffect(() => {
    const root = document.documentElement;
    const applyLight = (light: boolean) => root.classList.toggle("light", light);

    if (theme === "light") {
      applyLight(true);
      return;
    }
    if (theme === "dark") {
      applyLight(false);
      return;
    }

    // system
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    applyLight(mq.matches);
    const onChange = (e: MediaQueryListEvent) => applyLight(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  // Re-tint the primary accent whenever the user picks a different preset.
  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  // Window first-paint: the native window starts hidden so WebView2 never
  // flashes a blank/garbled transparent frame. Once React has committed and the
  // browser has painted a frame, signal the backend to reveal the window. The
  // Rust side also has a 1.5s fallback timer, so a missed event can't strand us.
  useEffect(() => {
    if (!isTauri) return;
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        void emit("app://ready");
      }),
    );
    return () => cancelAnimationFrame(raf);
  }, []);

  // Global hotkeys: Ctrl/⌘+K command palette, Ctrl/⌘+Enter toggle connection,
  // Ctrl/⌘+, settings, Ctrl/⌘+I import.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (e.key === "Enter") {
        e.preventDefault();
        void toggleActive();
      } else if (e.key === ",") {
        e.preventDefault();
        setScreen("settings");
      } else if (e.key.toLowerCase() === "i") {
        e.preventDefault();
        setImportOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Tray "toggle" menu item.
  useEffect(() => {
    if (!isTauri) return;
    const un = listen("tray://toggle", () => void toggleActive());
    return () => {
      un.then((u) => u());
    };
  }, []);

  // Auto-refresh subscriptions on their configured schedule.
  useEffect(() => startSubscriptionScheduler(), []);

  // Handle `nexusshield://` deep links forwarded from the native side: parse
  // the carried payload and import the servers / subscription it describes.
  useEffect(() => {
    if (!isTauri) return;
    const un = listen<string>("deep-link://new", (e) => {
      const parsed = parseDeepLink(e.payload);
      if (!parsed) return;
      const { addFromBlob, addSubscription } = useServerStore.getState();
      const lang = useSettingsStore.getState().app.language;
      let added = 0;
      if (parsed.blob) added += addFromBlob(parsed.blob).added;
      if (parsed.subscriptionUrl) {
        void addSubscription(parsed.subscriptionUrl, parsed.subscriptionUrl, 12).catch(() => {});
      }
      if (added > 0) toast.success(DEEPLINK_MSG[lang](added));
    });
    return () => {
      un.then((u) => u());
    };
  }, []);

  async function toggleActive() {
    const { activeServerId, toggle } = useConnectionStore.getState();
    const list = useServerStore.getState().servers;
    const target = list.find((s) => s.id === activeServerId) ?? list[0];
    if (target) await toggle(target);
  }

  if (!onboarded && servers.length === 0) {
    return (
      <Onboarding
        onDone={() => {
          localStorage.setItem("ns-onboarded", "1");
          setOnboarded(true);
        }}
        onImport={() => setImportOpen(true)}
        importNode={importOpen ? <ImportDialog onClose={() => setImportOpen(false)} /> : null}
      />
    );
  }

  return (
    <div className="relative flex h-screen flex-col">
      <AppBackground />
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar active={screen} onNavigate={setScreen} />
        <main className="relative z-[1] min-h-0 flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={screen}
              variants={pageVariants}
              initial="initial"
              animate="enter"
              exit="exit"
              className="h-full"
            >
              <ErrorBoundary
                resetKey={screen}
                labels={BOUNDARY_LABELS[language] ?? BOUNDARY_LABELS.en}
              >
                {screen === "connection" && (
                  <ConnectionScreen
                    onBrowse={() => setScreen("servers")}
                    onImport={() => setImportOpen(true)}
                  />
                )}
                {screen === "servers" && <ServersScreen onImport={() => setImportOpen(true)} />}
                {screen === "stats" && <StatsScreen />}
                {screen === "history" && <HistoryScreen />}
                {screen === "logs" && <LogsScreen />}
                {screen === "editor" && <EditorScreen />}
                {screen === "settings" && <SettingsScreen />}
              </ErrorBoundary>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={setScreen}
        onImport={() => setImportOpen(true)}
        onToggleConnection={() => void toggleActive()}
      />
      <Toaster />
    </div>
  );
}
