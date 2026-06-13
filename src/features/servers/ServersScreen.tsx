import { useMemo, useRef, useState } from "react";
import {
  Search,
  Plus,
  Activity,
  ArrowDownUp,
  Rocket,
  FolderTree,
  ChevronRight,
  RefreshCw,
  ChevronsDownUp,
  ChevronsUpDown,
} from "lucide-react";
import { useServerStore } from "../../store/useServerStore";
import { useConnectionStore } from "../../store/useConnectionStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { toast } from "../../store/useToastStore";
import { ServerCard } from "./ServerCard";
import { ALL_PROTOCOLS, PROTOCOL_LABEL } from "./protocolMeta";
import { cn } from "../../shared/lib/utils";
import { useT } from "../../core/i18n/useT";
import type { Lang } from "../../core/i18n";
import type { Protocol, ServerProfile } from "../../core/types";

type Filter = "all" | "favorites" | Protocol;
type Sort = "ping" | "name" | "recent";

const MANUAL_GROUP_ID = "__manual__";

// Inline localisation for the grouping UI — keeps the feature self-contained.
const GROUP_STRINGS: Record<
  Lang,
  {
    groupToggle: string;
    manual: string;
    refresh: string;
    pingGroup: string;
    collapseAll: string;
    expandAll: string;
  }
> = {
  en: {
    groupToggle: "Group by subscription",
    manual: "No subscription",
    refresh: "Update subscription",
    pingGroup: "Ping group",
    collapseAll: "Collapse all",
    expandAll: "Expand all",
  },
  ru: {
    groupToggle: "Группировать по подпискам",
    manual: "Без подписки",
    refresh: "Обновить подписку",
    pingGroup: "Пинг группы",
    collapseAll: "Свернуть все",
    expandAll: "Развернуть все",
  },
  fa: {
    groupToggle: "گروه‌بندی بر اساس اشتراک",
    manual: "بدون اشتراک",
    refresh: "به‌روزرسانی اشتراک",
    pingGroup: "پینگ گروه",
    collapseAll: "بستن همه",
    expandAll: "باز کردن همه",
  },
  zh: {
    groupToggle: "按订阅分组",
    manual: "无订阅",
    refresh: "更新订阅",
    pingGroup: "测试分组",
    collapseAll: "全部折叠",
    expandAll: "全部展开",
  },
};

export function ServersScreen({ onImport }: { onImport: () => void }) {
  const servers = useServerStore((s) => s.servers);
  const subscriptions = useServerStore((s) => s.subscriptions);
  const reorder = useServerStore((s) => s.reorder);
  const pingAll = useServerStore((s) => s.pingAll);
  const pingMany = useServerStore((s) => s.pingMany);
  const refreshSubscription = useServerStore((s) => s.refreshSubscription);
  const pingAllAndBest = useServerStore((s) => s.pingAllAndBest);
  const connect = useConnectionStore((s) => s.connect);
  const lang = useSettingsStore((s) => s.app.language);
  const gs = GROUP_STRINGS[lang] ?? GROUP_STRINGS.en;
  const t = useT();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("ping");
  const [pinging, setPinging] = useState(false);
  const [auto, setAuto] = useState(false);
  const [grouped, setGrouped] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [groupPinging, setGroupPinging] = useState<Record<string, boolean>>({});
  const dragId = useRef<string | null>(null);

  const filterSort = (list: ServerProfile[]): ServerProfile[] => {
    let r = list.filter((s) => {
      if (filter === "favorites") return s.favorite;
      if (filter !== "all") return s.protocol === filter;
      return true;
    });
    if (query.trim()) {
      const q = query.toLowerCase();
      r = r.filter(
        (s) => s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q),
      );
    }
    const sorted = [...r];
    if (sort === "ping") sorted.sort((a, b) => (a.latencyMs ?? 9999) - (b.latencyMs ?? 9999));
    else if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else sorted.sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
    return sorted;
  };

  const visible = useMemo(() => filterSort(servers), [servers, filter, query, sort]);

  const groups = useMemo(() => {
    const result: Array<{ id: string; name: string; servers: ServerProfile[] }> = [];
    for (const sub of subscriptions) {
      const items = filterSort(servers.filter((s) => s.subscriptionId === sub.id));
      if (items.length) result.push({ id: sub.id, name: sub.name, servers: items });
    }
    const manual = filterSort(servers.filter((s) => !s.subscriptionId));
    if (manual.length) result.push({ id: MANUAL_GROUP_ID, name: gs.manual, servers: manual });
    return result;
  }, [servers, subscriptions, filter, query, sort, gs.manual]);

  // Grouping only makes sense when not actively searching across everything.
  const showGroups = grouped && !query.trim();
  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed[g.id]);

  function handleDrop(id: string) {
    if (dragId.current && dragId.current !== id) reorder(dragId.current, id);
    dragId.current = null;
  }

  function toggleAll() {
    const next: Record<string, boolean> = {};
    for (const g of groups) next[g.id] = !allCollapsed;
    setCollapsed(next);
  }

  async function handlePingGroup(groupId: string) {
    const ids = servers
      .filter((s) => (groupId === MANUAL_GROUP_ID ? !s.subscriptionId : s.subscriptionId === groupId))
      .map((s) => s.id);
    if (ids.length === 0) return;
    setGroupPinging((m) => ({ ...m, [groupId]: true }));
    try {
      await pingMany(ids);
    } finally {
      setGroupPinging((m) => ({ ...m, [groupId]: false }));
    }
  }

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
          className="glass flex shrink-0 items-center gap-1.5 rounded-btn px-3 py-2 text-sm text-text-dim hover:text-text disabled:opacity-50"
        >
          <Activity size={15} className={pinging ? "animate-spin-slow" : ""} />
          {t("servers.pingAll")}
        </button>
        <button
          onClick={handleAutoBest}
          disabled={pinging || auto || servers.length === 0}
          className="glass flex shrink-0 items-center gap-1.5 rounded-btn px-3 py-2 text-sm text-teal hover:text-teal disabled:opacity-50"
        >
          <Rocket size={15} className={auto ? "animate-pulse" : ""} />
          {t("servers.autoBest")}
        </button>
        <button
          onClick={onImport}
          className="flex shrink-0 items-center gap-1.5 rounded-btn bg-indigo px-3 py-2 text-sm font-medium text-white hover:bg-indigo-soft"
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
        {showGroups && groups.length > 0 && (
          <button
            onClick={toggleAll}
            title={allCollapsed ? gs.expandAll : gs.collapseAll}
            className="flex shrink-0 items-center gap-1 rounded-btn px-2 py-1 text-xs text-text-dim transition-colors hover:text-text"
          >
            {allCollapsed ? <ChevronsUpDown size={13} /> : <ChevronsDownUp size={13} />}
          </button>
        )}
        <button
          onClick={() => setGrouped((g) => !g)}
          title={gs.groupToggle}
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-btn px-2 py-1 text-xs transition-colors",
            grouped ? "text-indigo" : "text-text-dim hover:text-text",
          )}
        >
          <FolderTree size={13} />
        </button>
        <button
          onClick={() => setSort(sort === "ping" ? "name" : sort === "name" ? "recent" : "ping")}
          className="flex shrink-0 items-center gap-1 rounded-btn px-2 py-1 text-xs text-text-dim hover:text-text"
        >
          <ArrowDownUp size={13} />
          {t(sort === "ping" ? "servers.sortPing" : sort === "name" ? "servers.sortName" : "servers.sortRecent")}
        </button>
      </div>

      {/* List */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
        {visible.length === 0 && (
          <p className="mt-10 text-center text-sm text-text-faint">
            {servers.length === 0 ? t("servers.emptyList") : t("servers.notFound")}
          </p>
        )}
        {visible.length > 0 && showGroups
          ? groups.map((g) => {
              const isCollapsed = !!collapsed[g.id];
              const sub = subscriptions.find((x) => x.id === g.id);
              const total = g.servers.length;
              const reachable = g.servers.filter((s) => (s.latencyMs ?? -1) >= 0).length;
              const tested = g.servers.some((s) => s.latencyMs != null);
              const updating = sub?.status === "updating";
              const gp = !!groupPinging[g.id];
              return (
                <div key={g.id} className="flex flex-col gap-2">
                  <div className="flex items-center gap-1.5 px-1 py-1">
                    <button
                      onClick={() => setCollapsed((c) => ({ ...c, [g.id]: !c[g.id] }))}
                      className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-text-dim transition-colors hover:text-text"
                    >
                      <ChevronRight
                        size={14}
                        className={cn("shrink-0 transition-transform", !isCollapsed && "rotate-90")}
                      />
                      <span className="truncate">{g.name}</span>
                      <span className="shrink-0 text-text-faint">{total}</span>
                    </button>
                    {tested && (
                      <span
                        className={cn(
                          "shrink-0 rounded px-1.5 font-mono text-[10px]",
                          reachable > 0 ? "text-ok" : "text-text-faint",
                        )}
                      >
                        {reachable}/{total}
                      </span>
                    )}
                    <div className="flex-1" />
                    <button
                      onClick={() => handlePingGroup(g.id)}
                      disabled={gp}
                      title={gs.pingGroup}
                      className="grid h-6 w-6 shrink-0 place-items-center rounded text-text-faint transition-colors hover:text-text disabled:opacity-50"
                    >
                      <Activity size={13} className={cn(gp && "animate-spin-slow")} />
                    </button>
                    {sub && (
                      <button
                        onClick={() => refreshSubscription(g.id)}
                        disabled={updating}
                        title={gs.refresh}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded text-text-faint transition-colors hover:text-text disabled:opacity-50"
                      >
                        <RefreshCw size={13} className={cn(updating && "animate-spin")} />
                      </button>
                    )}
                  </div>
                  {!isCollapsed &&
                    g.servers.map((s) => (
                      <ServerCard
                        key={s.id}
                        server={s}
                        onDragStart={(id) => (dragId.current = id)}
                        onDrop={handleDrop}
                      />
                    ))}
                </div>
              );
            })
          : visible.map((s) => (
              <ServerCard
                key={s.id}
                server={s}
                onDragStart={(id) => (dragId.current = id)}
                onDrop={handleDrop}
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
