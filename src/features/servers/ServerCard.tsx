import { useState } from "react";
import { Star, MoreVertical, Activity, Copy, Trash2, Power } from "lucide-react";
import type { ServerProfile } from "../../core/types";
import { useServerStore } from "../../store/useServerStore";
import { useConnectionStore } from "../../store/useConnectionStore";
import { cn, latencyColor, latencyLabel } from "../../shared/lib/utils";
import { flagFor } from "../../shared/lib/flags";
import { PROTOCOL_LABEL } from "./protocolMeta";

export function ServerCard({
  server,
  onDragStart,
  onDrop,
}: {
  server: ServerProfile;
  onDragStart: (id: string) => void;
  onDrop: (id: string) => void;
}) {
  const { toggleFavorite, duplicateServer, removeServer, pingOne } = useServerStore();
  const { toggle, activeServerId, status } = useConnectionStore();
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = activeServerId === server.id && status === "connected";

  return (
    <div
      draggable
      onDragStart={() => onDragStart(server.id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => onDrop(server.id)}
      onDoubleClick={() => toggle(server)}
      className={cn(
        "group glass relative flex items-center gap-3 rounded-card px-3.5 py-3 transition-all hover:border-indigo/40",
        isActive && "border-ok/50 bg-ok/5",
      )}
    >
      <span className="text-2xl leading-none">{flagFor(server.name)}</span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-text">{server.name}</span>
          {server.tags.map((t) => (
            <span key={t} className="rounded bg-surface px-1.5 text-[10px] text-text-dim">
              #{t}
            </span>
          ))}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-text-dim">
          <span className="font-medium text-indigo">{PROTOCOL_LABEL[server.protocol]}</span>
          <span className="font-mono uppercase">{server.transport.type}</span>
          {server.tls.security !== "none" && (
            <span className="font-mono uppercase text-teal">{server.tls.security}</span>
          )}
          <span className="truncate font-mono text-text-faint">{server.address}</span>
        </div>
      </div>

      {/* Latency */}
      <button
        onClick={() => pingOne(server.id)}
        title="Тест задержки"
        className={cn("flex items-center gap-1 font-mono text-xs", latencyColor(server.latencyMs))}
      >
        <Activity size={13} />
        {latencyLabel(server.latencyMs)}
      </button>

      {/* Favorite */}
      <button onClick={() => toggleFavorite(server.id)} title="В избранное">
        <Star
          size={16}
          className={cn(
            server.favorite ? "fill-warn text-warn" : "text-text-faint hover:text-warn",
          )}
        />
      </button>

      {/* Connect */}
      <button
        onClick={() => toggle(server)}
        className={cn(
          "grid h-8 w-8 place-items-center rounded-btn transition-colors",
          isActive ? "bg-ok text-white" : "bg-surface text-text-dim hover:bg-indigo hover:text-white",
        )}
        title={isActive ? "Отключить" : "Подключить"}
      >
        <Power size={15} />
      </button>

      {/* Context menu */}
      <div className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
          className="grid h-8 w-7 place-items-center rounded-btn text-text-faint hover:bg-surface hover:text-text"
        >
          <MoreVertical size={16} />
        </button>
        {menuOpen && (
          <div className="glass-elev absolute right-0 top-9 z-20 w-40 overflow-hidden rounded-card py-1 text-sm shadow-xl">
            <MenuRow icon={Activity} onClick={() => pingOne(server.id)}>
              Тест
            </MenuRow>
            <MenuRow icon={Copy} onClick={() => duplicateServer(server.id)}>
              Дублировать
            </MenuRow>
            <MenuRow icon={Trash2} danger onClick={() => removeServer(server.id)}>
              Удалить
            </MenuRow>
          </div>
        )}
      </div>
    </div>
  );
}

function MenuRow({
  icon: Icon,
  children,
  onClick,
  danger,
}: {
  icon: React.ElementType;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onMouseDown={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-surface",
        danger ? "text-bad" : "text-text-dim",
      )}
    >
      <Icon size={14} /> {children}
    </button>
  );
}
