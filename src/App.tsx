import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "framer-motion";
import { TitleBar } from "./shared/components/TitleBar";
import { Sidebar, type Screen } from "./shared/components/Sidebar";
import { ConnectionScreen } from "./features/connection/ConnectionScreen";
import { ServersScreen } from "./features/servers/ServersScreen";
import { StatsScreen } from "./features/stats/StatsScreen";
import { SettingsScreen } from "./features/settings/SettingsScreen";
import { EditorScreen } from "./features/editor/EditorScreen";
import { ImportDialog } from "./features/import/ImportDialog";
import { Onboarding } from "./features/onboarding/Onboarding";
import { useCoreEvents } from "./shared/hooks/useCoreEvents";
import { useTrafficPoller } from "./shared/hooks/useTrafficPoller";
import { isTauri } from "./core/ipc";
import { useServerStore } from "./store/useServerStore";
import { useConnectionStore } from "./store/useConnectionStore";
import { startSubscriptionScheduler } from "./core/subscriptions/scheduler";
import { pageVariants } from "./shared/lib/motion";

export default function App() {
  const [screen, setScreen] = useState<Screen>("connection");
  const [importOpen, setImportOpen] = useState(false);
  const servers = useServerStore((s) => s.servers);
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem("ns-onboarded") === "1");

  useCoreEvents();
  useTrafficPoller();

  // Global hotkeys: Ctrl+K toggle connection, Ctrl+, settings, Ctrl+I import.
  useEffect(() => {
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
              {screen === "editor" && <EditorScreen />}
              {screen === "settings" && <SettingsScreen />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
    </div>
  );
}
