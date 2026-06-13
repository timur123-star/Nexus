import { lazy, Suspense, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "framer-motion";
import { TitleBar } from "./shared/components/TitleBar";
import { Sidebar, type Screen } from "./shared/components/Sidebar";
import { Toaster } from "./shared/components/Toaster";
import { ConnectionScreen } from "./features/connection/ConnectionScreen";
import { ServersScreen } from "./features/servers/ServersScreen";
import { StatsScreen } from "./features/stats/StatsScreen";
import { HistoryScreen } from "./features/history/HistoryScreen";
import { LogsScreen } from "./features/logs/LogsScreen";
import { SettingsScreen } from "./features/settings/SettingsScreen";
const EditorScreen = lazy(() =>
  import("./features/editor/EditorScreen").then((m) => ({ default: m.EditorScreen })),
);
import { ImportDialog } from "./features/import/ImportDialog";
import { Onboarding } from "./features/onboarding/Onboarding";
import { useCoreEvents } from "./shared/hooks/useCoreEvents";
import { useTrafficPoller } from "./shared/hooks/useTrafficPoller";
import { useConnectionToasts } from "./shared/hooks/useConnectionToasts";
import { useSessionHistory } from "./shared/hooks/useSessionHistory";
import { isTauri } from "./core/ipc";
import { useServerStore } from "./store/useServerStore";
import { useConnectionStore } from "./store/useConnectionStore";
import { useSettingsStore } from "./store/useSettingsStore";
import { startSubscriptionScheduler } from "./core/subscriptions/scheduler";
import { pageVariants } from "./shared/lib/motion";
import { applyAccent } from "./shared/lib/accents";

export default function App() {
  const [screen, setScreen] = useState<Screen>("connection");
  const [importOpen, setImportOpen] = useState(false);
  const servers = useServerStore((s) => s.servers);
  const theme = useSettingsStore((s) => s.app.theme);
  const accent = useSettingsStore((s) => s.app.accent);
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem("ns-onboarded") === "1");

  useCoreEvents();
  useTrafficPoller();
  useConnectionToasts();
  useSessionHistory();

  // Apply the chosen theme to the document root. The light palette lives under
  // `:root.light` in index.css, so without this the selector in Settings did
  // nothing. In "system" mode we follow (and keep following) the OS preference.
  useEffect(() => {
    const root = document.documentElement;
    const apply = (light: boolean, oled: boolean) => {
      root.classList.toggle("light", light);
      root.classList.toggle("oled", oled);
    };

    if (theme === "light") {
      apply(true, false);
      return;
    }
    if (theme === "oled") {
      apply(false, true);
      return;
    }
    if (theme === "dark") {
      apply(false, false);
      return;
    }

    // system
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    apply(mq.matches, false);
    const onChange = (e: MediaQueryListEvent) => apply(e.matches, false);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  // Re-tint the primary accent whenever the user picks a different preset.
  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  // Global hotkeys: Ctrl+K toggle connection, Ctrl+, settings, Ctrl+I import,
  // Ctrl+1-7 navigate screens.
  useEffect(() => {
    const SCREEN_MAP: Record<string, Screen> = {
      "1": "connection",
      "2": "servers",
      "3": "stats",
      "4": "history",
      "5": "logs",
      "6": "editor",
      "7": "settings",
    };
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === "k") {
        e.preventDefault();
        void toggleActive();
      } else if (e.key === ",") {
        e.preventDefault();
        setScreen("settings");
      } else if (e.key.toLowerCase() === "i") {
        e.preventDefault();
        setImportOpen(true);
      } else if (SCREEN_MAP[e.key]) {
        e.preventDefault();
        setScreen(SCREEN_MAP[e.key]);
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
              {screen === "connection" && <ConnectionScreen onBrowse={() => setScreen("servers")} />}
              {screen === "servers" && <ServersScreen onImport={() => setImportOpen(true)} />}
              {screen === "stats" && <StatsScreen />}
              {screen === "history" && <HistoryScreen />}
              {screen === "logs" && <LogsScreen />}
              {screen === "editor" && (
                <Suspense fallback={<div className="flex h-full items-center justify-center text-text-faint">Loading editor…</div>}>
                  <EditorScreen />
                </Suspense>
              )}
              {screen === "settings" && <SettingsScreen />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
      <Toaster />
    </div>
  );
}
