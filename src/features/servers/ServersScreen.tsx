import { useMemo, useRef, useState } from "react";
import { Search, Plus, Activity, ArrowDownUp, Rocket } from "lucide-react";
import { useServerStore } from "../../store/useServerStore";
import { useConnectionStore } from "../../store/useConnectionStore";
import { toast } from "../../store/useToastStore";
import { ServerCard } from "./ServerCard";
import { ALL_PROTOCOLS, PROTOCOL_LABEL } from "./protocolMeta";
import { cn } from "../../shared/lib/utils";
import { useT } from "../../core/i18n/useT";
import type { Protocol } from "../../core/types";

type Filter = "all" | "favorites" | Protocol;
type Sort = "ping" | "name" | "recent";

export function ServersScreen({ onImport }: { onImport: () => void }) {
  const servers = useServerStore((s) => s.servers);
  const reorder = useServerStore((s) => s.reorder);
  const pingAll = useServerStore((s) => s.pingAll);
  const pingAllAndBest = useServerStore((s) => s.pingAllAndBest);
  const connect = useConnectionStore((s) => s.connect);
  const t = useT();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("ping");
  const [pinging, setPinging] = useState(false);
  const [auto, setAuto] = useState(false);
  const dragId = useRef<string | null>(null);

  const visible = useMemo(() => {
    let list = servers.filter((s) => {
      if (filter === "favorites") return s.favorite;
      if (filter !== "all") return s.protocol === filter;
      return true;
    });
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (s) => s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q),
      );
    }
    const sorted = [...list];
    if (sort === "ping") sorted.sort((a, b) => (a.latencyMs ?? 9999) - (b.latencyMs ?? 9999));
    else if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else sorted.sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
    return sorted;
  }, [servers, filter, query, sort]);

  async function handlePingAll() {
    setPinging(true);
    try {
      await pingAll();
    } finally {
      setPinging(false);
    }
  }

  async function handleAutoBest() {
    setAuto(true);
    try {
      const best = await pingAllAndBest();
      if (best) {
        toast.success(t("servers.autoConnecting", { name: best.name }));
        await connect(best);
      } else {
        toast.warning(t("servers.autoNone"));
      }
    } finally {
      setAuto(false);
    }
  }

  return (
    <div className="flex h-full flex-col p-5">
      {/* Toolbar */}
      <div className="mb-4 flex items-center gap-2">
        <div className="glass flex flex-1 items-center gap-2 rounded-btn px-3 py-2">
          <Search size={16} className="text-text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("servers.searchPlaceholder")}
            className="w-full bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
          />
        </div>
        <button
          onClick={handlePingAll}
          disabled={pinging || auto}
          className="glass flex items-center gap-1.5 rounded-btn px-3 py-2 text-sm text-text-dim hover:text-text disabled:opacity-50"
        >
          <Activity size={15} className={pinging ? "animate-spin-slow" : ""} />
          {t("servers.pingAll")}
        </button>
        <button
          onClick={handleAutoBest}
          disabled={pinging || auto || servers.length === 0}
          className="glass flex items-center gap-1.5 rounded-btn px-3 py-2 text-sm text-teal hover:text-teal disabled:opacity-50"
        >
          <Rocket size={15} className={auto ? "animate-pulse" : ""} />
          {t("servers.autoBest")}
        </button>
        <button
          onClick={onImport}
          className="flex items-center gap-1.5 rounded-btn bg-indigo px-3 py-2 text-sm font-medium text-white hover:bg-indigo-soft"
        >
          <Plus size={16} /> {t("common.add")}
        </button>
      </div>

      {/* Filters + sort */}
      <div className="mb-3 flex items-center gap-1.5 overflow-x-auto pb-1">
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>
          {t("servers.filterAll")}
        </Chip>
        <Chip active={filter === "favorites"} onClick={() => setFilter("favorites")}>
          {t("servers.filterFavorites")}
        </Chip>
        {ALL_PROTOCOLS.map((p) => (
          <Chip key={p} active={filter === p} onClick={() => setFilter(p)}>
            {PROTOCOL_LABEL[p]}
          </Chip>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => setSort(sort === "ping" ? "name" : sort === "name" ? "recent" : "ping")}
          className="flex shrink-0 items-center gap-1 rounded-btn px-2 py-1 text-xs text-text-dim hover:text-text"
        >
          <ArrowDownUp size={13} />
          {t(sort === "ping" ? "servers.sortPing" : sort === "name" ? "servers.sortName" : "servers.sortRecent")}
        </button>
      </div>

      {/* List */}
      <div className="flex flex-col gap-2 overflow-y-auto pr-1">
        {visible.length === 0 && (
          <p className="mt-10 text-center text-sm text-text-faint">
            {servers.length === 0 ? t("servers.emptyList") : t("servers.notFound")}
          </p>
        )}
        {visible.map((s) => (
          <ServerCard
            key={s.id}
            server={s}
            onDragStart={(id) => (dragId.current = id)}
            onDrop={(id) => {
              if (dragId.current && dragId.current !== id) reorder(dragId.current, id);
              dragId.current = null;
            }}
          />
        ))}
      </div>

      <div className="mt-3 shrink-0 text-center text-[11px] text-text-faint">
        {t("servers.footer", { count: servers.length })}
      </div>
    </div>
  );
}

function Chip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
        active ? "bg-indigo text-white" : "glass text-text-dim hover:text-text",
      )}
    >
      {children}
    </button>
  );
}
