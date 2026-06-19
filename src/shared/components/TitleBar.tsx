import { useState } from "react";
import { Minus, X, Square, Minimize2, Maximize2 } from "lucide-react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { isTauri } from "../../core/ipc";
import { useConnectionStore } from "../../store/useConnectionStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { cn, latencyLabel } from "../lib/utils";
import { Flag } from "./Flag";
import { useServerStore } from "../../store/useServerStore";
import { useT } from "../../core/i18n/useT";
import logoLockup from "../../assets/logo-lockup.png";
import type { ConnectionStatus } from "../../core/types";
import type { MessageKey } from "../../core/i18n";

const STATUS_KEY: Record<ConnectionStatus, MessageKey> = {
  disconnected: "conn.disconnected",
  connecting: "conn.connecting",
  connected: "conn.connected",
  reconnecting: "conn.reconnecting",
  error: "conn.error",
};

export function TitleBar() {
  const status = useConnectionStore((s) => s.status);
  const activeId = useConnectionStore((s) => s.activeServerId);
  const exitInfo = useConnectionStore((s) => s.exitInfo);
  const active = useServerStore((s) => s.servers.find((x) => x.id === activeId));
  const minimizeToTray = useSettingsStore((s) => s.app.minimizeToTray);
  const t = useT();

  const [mini, setMini] = useState(false);
  const win = isTauri ? getCurrentWindow() : null;

  // Mini mode: shrink the window to a compact widget for a glanceable, always-
  // on-top connection view, and restore the previous size on the way back.
  const toggleMini = async () => {
    if (!win) return;
    try {
      if (!mini) {
        await win.setSize(new LogicalSize(380, 540));
        await win.setAlwaysOnTop(true);
        setMini(true);
      } else {
        await win.setSize(new LogicalSize(1040, 720));
        await win.setAlwaysOnTop(false);
        setMini(false);
      }
    } catch {
      /* window ops are best-effort */
    }
  };

  const dotColor =
    status === "connected" ? "bg-ok" : status === "connecting" ? "bg-warn" : status === "error" ? "bg-bad" : "bg-text-faint";

  // Closing hides to tray only when the user opted in; otherwise quit for real.
  const handleClose = () => {
    if (minimizeToTray) win?.hide();
    else win?.close();
  };

  return (
    <div
      data-tauri-drag-region
      className="relative z-10 flex h-14 shrink-0 items-center justify-between border-b border-border/60 px-3 select-none"
    >
      <div data-tauri-drag-region className="flex items-center text-text">
        <img
          src={logoLockup}
          alt="NexusShield"
          draggable={false}
          className="h-9 w-auto select-none object-contain drop-shadow-[0_0_10px_rgba(220,38,38,0.35)]"
        />
      </div>

      <div data-tauri-drag-region className="flex items-center gap-2 text-xs text-text-dim">
        <span className={cn("h-2 w-2 rounded-full", dotColor, status === "connecting" && "animate-pulse")} />
        <span>{t(STATUS_KEY[status] ?? "conn.disconnected")}</span>
        {status === "connected" && active?.latencyMs != null && (
          <span className="font-mono text-text-faint">· {latencyLabel(active.latencyMs)}</span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <WinBtn onClick={() => void toggleMini()} label="mini">
          {mini ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
        </WinBtn>
        <WinBtn onClick={() => win?.minimize()} label="minimize">
          <Minus size={15} />
        </WinBtn>
        <WinBtn onClick={() => win?.toggleMaximize()} label="maximize">
          <Square size={12} />
        </WinBtn>
        <WinBtn onClick={handleClose} label="close" danger>
          <X size={15} />
        </WinBtn>
      </div>
    </div>
  );
}

function WinBtn({
  children,
  onClick,
  label,
  danger,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={cn(
        "grid h-7 w-8 place-items-center rounded-md text-text-dim transition-colors",
        danger ? "hover:bg-bad hover:text-white" : "hover:bg-surface hover:text-text",
      )}
    >
      {children}
    </button>
  );
}
