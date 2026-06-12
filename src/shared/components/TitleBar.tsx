import { Minus, X, Square, Shield } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../../core/ipc";
import { useConnectionStore } from "../../store/useConnectionStore";
import { cn, latencyLabel } from "../lib/utils";
import { useServerStore } from "../../store/useServerStore";

const STATUS_TEXT: Record<string, string> = {
  disconnected: "Отключено",
  connecting: "Подключение…",
  connected: "Подключено",
  reconnecting: "Переподключение…",
  error: "Ошибка",
};

export function TitleBar() {
  const status = useConnectionStore((s) => s.status);
  const activeId = useConnectionStore((s) => s.activeServerId);
  const active = useServerStore((s) => s.servers.find((x) => x.id === activeId));

  const win = isTauri ? getCurrentWindow() : null;
  const dotColor =
    status === "connected" ? "bg-ok" : status === "connecting" ? "bg-warn" : status === "error" ? "bg-bad" : "bg-text-faint";

  return (
    <div
      data-tauri-drag-region
      className="flex h-11 shrink-0 items-center justify-between border-b border-border/60 px-3 select-none"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 text-text">
        <Shield size={17} className="text-indigo" />
        <span className="text-[13px] font-semibold tracking-wide">NexusShield</span>
      </div>

      <div data-tauri-drag-region className="flex items-center gap-2 text-xs text-text-dim">
        <span className={cn("h-2 w-2 rounded-full", dotColor, status === "connecting" && "animate-pulse")} />
        <span>{STATUS_TEXT[status] ?? status}</span>
        {status === "connected" && active?.latencyMs != null && (
          <span className="font-mono text-text-faint">· {latencyLabel(active.latencyMs)}</span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <WinBtn onClick={() => win?.minimize()} label="свернуть">
          <Minus size={15} />
        </WinBtn>
        <WinBtn onClick={() => win?.toggleMaximize()} label="развернуть">
          <Square size={12} />
        </WinBtn>
        <WinBtn onClick={() => win?.hide()} label="закрыть" danger>
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
