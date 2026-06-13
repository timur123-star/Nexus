import { useState } from "react";
import { motion } from "framer-motion";
import { Star, MoreVertical, Activity, Copy, Trash2, Power, Loader2, GripVertical, CheckSquare, Square, Share2 } from "lucide-react";
import type { ServerProfile } from "../../core/types";
import { useServerStore } from "../../store/useServerStore";
import { useConnectionStore } from "../../store/useConnectionStore";
import { cn, latencyColor, latencyLabel } from "../../shared/lib/utils";
import { Flag } from "../../shared/components/Flag";
import { useT } from "../../core/i18n/useT";
import { PROTOCOL_LABEL } from "./protocolMeta";
import { ShareDialog } from "./ShareDialog";

const activeDotAnimate = { opacity: [1, 0.3, 1], scale: [1, 1.5, 1] };
const activeDotTransition = { duration: 1.6, repeat: Infinity, ease: "easeInOut" };

export function ServerCard({
  server,
  batchMode,
  batchSelected,
  onBatchToggle,
  onDragStart,
  onDrop,
}: {
  server: ServerProfile;
  batchMode?: boolean;
  batchSelected?: boolean;
  onBatchToggle?: () => void;
  onDragStart: (id: string) => void;
  onDrop: (id: string) => void;
}) {
  const { toggleFavorite, duplicateServer, removeServer, pingOne } = useServerStore();
  const { toggle, activeServerId, status } = useConnectionStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const t = useT();

  const isCurrent = activeServerId === server.id;
  const isActive = isCurrent && status === "connected";
  // This server is the one mid-handshake (initial connect or auto-reconnect).
  const isBusy = isCurrent && (status === "connecting" || status === "reconnecting");

  const handlePing = async () => {
    if (pinging) return;
    setPinging(true);
    try {
      await pingOne(server.id);
    } finally {
      setPinging(false);
    }
  };

  return (
    <div
      draggable
      onDragStart={() => onDragStart(server.id)}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={() => {
        setDragOver(false);
        onDrop(server.id);
      }}
      onDragEnd={() => setDragOver(false)}
      onDoubleClick={() => toggle(server)}
      className={cn(
        "group glass ns-lift relative flex items-center gap-3 rounded-card px-3.5 py-3 transition-all hover:border-indigo/40",
        isActive && "border-ok/50 bg-ok/5",
        isBusy && "border-indigo/50 bg-indigo/5",
        dragOver && "ring-2 ring-indigo/60",
      )}
    >
      {batchMode ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onBatchToggle?.();
          }}
          className="-ml-1 shrink-0 text-text-dim hover:text-indigo"
          aria-label={batchSelected ? "Deselect" : "Select"}
        >
          {batchSelected ? (
            <CheckSquare size={18} className="text-indigo" />
          ) : (
            <Square size={18} />
          )}
        </button>
      ) : (
        <GripVertical
          size={15}
          aria-hidden
          className="-ml-1 shrink-0 cursor-grab text-text-faint/40 opacity-0 transition-opacity group-hover:opacity-100"
        />
      )}

      <Flag name={server.name} address={server.address} size={28} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-text">{server.name}</span>
          {isActive && (
            <motion.span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok"
              animate={activeDotAnimate}
              transition={activeDotTransition}
            />
          )}
          {isBusy && (
            <motion.span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn"
              animate={activeDotAnimate}
              transition={activeDotTransition}
            />
          )}
          {server.tags.map((tag) => (
            <span key={tag} className="shrink-0 rounded bg-surface px-1.5 text-[10px] text-text-dim">
              #{tag}
            </span>
          ))}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-text-dim">
          <span className="shrink-0 font-medium text-indigo">{PROTOCOL_LABEL[server.protocol]}</span>
          <span className="shrink-0 font-mono uppercase">{server.transport.type}</span>
          {server.tls.security !== "none" && (
            <span className="shrink-0 font-mono uppercase text-teal">{server.tls.security}</span>
          )}
          <span className="truncate font-mono text-text-faint">{server.address}</span>
        </div>
      </div>

      {/* Latency */}
      <button
        onClick={handlePing}
        disabled={pinging}
        title={t("servers.latencyTest")}
        className={cn("flex shrink-0 items-center gap-1 font-mono text-xs", latencyColor(server.latencyMs))}
      >
        <Activity size={13} className={cn(pinging && "animate-spin-slow")} />
        {latencyLabel(server.latencyMs)}
      </button>

      {/* Favorite */}
      <button onClick={() => toggleFavorite(server.id)} title={t("servers.favorite")} className="shrink-0">
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
          "grid h-8 w-8 shrink-0 place-items-center rounded-btn transition-colors",
          isActive
            ? "bg-ok text-white"
            : isBusy
              ? "bg-indigo text-white"
              : "bg-surface text-text-dim hover:bg-indigo hover:text-white",
        )}
        title={isBusy ? t("conn.connecting") : isActive ? t("common.disconnect") : t("common.connect")}
      >
        {isBusy ? <Loader2 size={15} className="animate-spin" /> : <Power size={15} />}
      </button>

      {/* Context menu */}
      <div className="relative shrink-0">
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
              {t("servers.menuTest")}
            </MenuRow>
            <MenuRow icon={Copy} onClick={() => duplicateServer(server.id)}>
              {t("servers.duplicate")}
            </MenuRow>
            <MenuRow icon={Share2} onClick={() => setShareOpen(true)}>
              {t("servers.share")}
            </MenuRow>
            <MenuRow icon={Trash2} danger onClick={() => removeServer(server.id)}>
              {t("common.delete")}
            </MenuRow>
          </div>
        )}
      </div>

      {shareOpen && <ShareDialog server={server} onClose={() => setShareOpen(false)} />}
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
