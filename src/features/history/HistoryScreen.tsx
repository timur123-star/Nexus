import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Activity, ArrowDown, ArrowUp, Clock, Cpu, History, Server, Trash2 } from "lucide-react";
import { useHistoryStore } from "../../store/useHistoryStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { useT } from "../../core/i18n/useT";
import type { Lang } from "../../core/i18n";
import { fadeInUp } from "../../shared/lib/motion";
import { cn, formatBytes, formatUptime } from "../../shared/lib/utils";

type Filter = "all" | "sing-box" | "xray";

const LOCALE: Record<Lang, string> = {
  ru: "ru-RU",
  en: "en-US",
  fa: "fa-IR",
  zh: "zh-CN",
};

// Inline 4-language copy so the global dictionary (and its parity test) is left
// untouched; consistent with the other feature screens.
const HISTORY_STRINGS: Record<Lang, Record<string, string>> = {
  en: {
    title: "Connection history",
    subtitle: "Past sessions, duration and data used",
    sessions: "Sessions",
    data: "Data used",
    totalTime: "Time connected",
    empty: "No sessions yet. Connect to start tracking.",
    emptyTitle: "Session history is empty",
    emptyLine1: "Your past connections will appear here.",
    emptyLine2: "Connect to a server to start tracking.",
    clearAll: "Clear all",
    all: "All",
    remove: "Remove",
  },
  ru: {
    title: "История подключений",
    subtitle: "Прошлые сессии, длительность и трафик",
    sessions: "Сессий",
    data: "Трафик",
    totalTime: "Время онлайн",
    empty: "Сессий пока нет. Подключитесь, чтобы начать.",
    emptyTitle: "История сессий пуста",
    emptyLine1: "Здесь будут отображаться ваши прошлые подключения.",
    emptyLine2: "Подключитесь к серверу, чтобы начать отслеживание.",
    clearAll: "Очистить",
    all: "Все",
    remove: "Удалить",
  },
  fa: {
    title: "تاریخچه اتصال",
    subtitle: "نشست‌های گذشته، مدت و مصرف داده",
    sessions: "نشست‌ها",
    data: "داده مصرفی",
    totalTime: "زمان اتصال",
    empty: "هنوز نشستی نیست. برای شروع وصل شوید.",
    emptyTitle: "تاریخچهٔ نشست‌ها خالی است",
    emptyLine1: "اتصال‌های گذشتهٔ شما اینجا نمایش داده می‌شود.",
    emptyLine2: "برای شروع ردیابی به یک سرور وصل شوید.",
    clearAll: "پاک کردن",
    all: "همه",
    remove: "حذف",
  },
  zh: {
    title: "连接历史",
    subtitle: "过往会话、时长与流量",
    sessions: "会话数",
    data: "流量",
    totalTime: "在线时长",
    empty: "暂无会话。连接后开始记录。",
    emptyTitle: "会话历史为空",
    emptyLine1: "您过往的连接将显示在此处。",
    emptyLine2: "连接到服务器即可开始记录。",
    clearAll: "清空",
    all: "全部",
    remove: "删除",
  },
};

const FILTERS: Filter[] = ["all", "sing-box", "xray"];

export function HistoryScreen() {
  const sessions = useHistoryStore((s) => s.sessions);
  const removeOne = useHistoryStore((s) => s.removeOne);
  const clear = useHistoryStore((s) => s.clear);
  const lang = useSettingsStore((s) => s.app.language);
  const t = useT();
  const [filter, setFilter] = useState<Filter>("all");

  const hs = HISTORY_STRINGS[lang] ?? HISTORY_STRINGS.en;
  const units = { h: t("common.unit.h"), m: t("common.unit.m"), s: t("common.unit.s") };

  const visible = useMemo(
    () => (filter === "all" ? sessions : sessions.filter((x) => x.core === filter)),
    [sessions, filter],
  );

  // Totals follow the active filter so the summary cards always match the list.
  const totals = useMemo(
    () =>
      visible.reduce(
        (acc, s) => {
          acc.down += s.bytesDown;
          acc.up += s.bytesUp;
          acc.time += s.durationMs;
          return acc;
        },
        { down: 0, up: 0, time: 0 },
      ),
    [visible],
  );

  const fmtDate = (ts: number): string =>
    new Intl.DateTimeFormat(LOCALE[lang] ?? "en-US", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(ts);

  const coreLabel = (core: string | null): string =>
    core === "xray" ? "Xray" : core === "sing-box" ? "sing-box" : "\u2014";
  const filterLabel = (f: Filter): string =>
    f === "all" ? hs.all : f === "sing-box" ? "sing-box" : "Xray";
  // Per-filter session counts shown as a subtle badge on each chip.
  const filterCount = (f: Filter): number =>
    f === "all" ? sessions.length : sessions.filter((x) => x.core === f).length;

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-5">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-btn bg-indigo/15 text-indigo">
            <History size={18} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-text">{hs.title}</h2>
            <p className="text-[11px] text-text-faint">{hs.subtitle}</p>
          </div>
        </div>
        {sessions.length > 0 && (
          <button
            onClick={clear}
            className="flex items-center gap-1.5 rounded-btn px-3 py-2 text-xs text-text-faint transition-colors hover:text-bad"
          >
            <Trash2 size={14} /> {hs.clearAll}
          </button>
        )}
      </header>

      <div className="grid grid-cols-3 gap-3">
        <SummaryCard icon={Activity} label={hs.sessions} value={String(visible.length)} />
        <div className="glass rounded-card p-4">
          <div className="flex items-center gap-1.5 text-[11px] text-text-faint">
            <Activity size={13} /> {hs.data}
          </div>
          <div className="mt-1 flex items-center gap-3 font-mono text-base font-semibold">
            <span className="flex items-center gap-1 text-teal">
              <ArrowDown size={14} /> {formatBytes(totals.down)}
            </span>
            <span className="flex items-center gap-1 text-indigo">
              <ArrowUp size={14} /> {formatBytes(totals.up)}
            </span>
          </div>
        </div>
        <SummaryCard icon={Clock} label={hs.totalTime} value={formatUptime(totals.time, units)} />
      </div>

      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "flex items-center gap-1.5 rounded-btn border px-3 py-1.5 text-xs transition-colors",
              filter === f
                ? "border-indigo bg-indigo/10 text-indigo"
                : "border-border text-text-dim hover:text-text",
            )}
          >
            {filterLabel(f)}
            <span
              className={cn(
                "rounded-full px-1.5 text-[10px] font-mono",
                filter === f ? "bg-indigo/20 text-indigo" : "bg-surface text-text-faint",
              )}
            >
              {filterCount(f)}
            </span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="glass grid place-items-center rounded-card px-6 py-16 text-center">
          <EmptyOrb />
          <h3 className="mt-6 text-base font-semibold text-text">{hs.emptyTitle}</h3>
          <p className="mt-2 text-sm text-text-faint">{hs.emptyLine1}</p>
          <p className="text-sm text-text-faint">{hs.emptyLine2}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((s, i) => (
            <motion.div
              key={s.id}
              custom={i}
              variants={fadeInUp}
              initial="initial"
              animate="enter"
              className="glass flex items-center gap-3 rounded-card px-4 py-3"
            >
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-btn bg-surface text-text-dim">
                <Server size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-text">{s.serverName}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-text-faint">
                  <span>{fmtDate(s.startedAt)}</span>
                  <span className="flex items-center gap-1">
                    <Cpu size={11} /> {coreLabel(s.core)}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5 text-xs">
                <span className="flex items-center gap-1 text-text-dim">
                  <Clock size={12} /> {formatUptime(s.durationMs, units)}
                </span>
                <span className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="flex items-center gap-0.5 text-teal">
                    <ArrowDown size={11} /> {formatBytes(s.bytesDown)}
                  </span>
                  <span className="flex items-center gap-0.5 text-indigo">
                    <ArrowUp size={11} /> {formatBytes(s.bytesUp)}
                  </span>
                </span>
              </div>
              <button
                onClick={() => removeOne(s.id)}
                title={hs.remove}
                aria-label={hs.remove}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-btn text-text-faint transition-colors hover:bg-surface hover:text-bad"
              >
                <Trash2 size={14} />
              </button>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Glowing concentric-ring empty-state emblem with a history clock at its centre. */
function EmptyOrb() {
  const ticks = Array.from({ length: 48 });
  return (
    <div className="relative grid h-40 w-40 place-items-center">
      {/* Soft outer glow */}
      <div className="absolute inset-0 rounded-full bg-indigo/15 blur-2xl" />
      {/* Rotating tick ring */}
      <motion.div
        className="absolute inset-2"
        animate={{ rotate: 360 }}
        transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
      >
        {ticks.map((_, i) => (
          <span
            key={i}
            className="absolute left-1/2 top-1/2 h-1.5 w-px -translate-x-1/2 origin-[center_72px] bg-indigo/40"
            style={{ transform: `translate(-50%, -50%) rotate(${(360 / ticks.length) * i}deg) translateY(-72px)` }}
          />
        ))}
      </motion.div>
      {/* Static rings */}
      <div className="absolute inset-6 rounded-full border border-indigo/30" />
      <div className="absolute inset-10 rounded-full border border-indigo/50 shadow-[0_0_24px_rgba(220,38,38,0.35)]" />
      {/* Core */}
      <div className="relative grid h-16 w-16 place-items-center rounded-full bg-indigo/15 text-indigo shadow-[0_0_30px_rgba(220,38,38,0.45)]">
        <History size={30} />
      </div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="glass rounded-card p-4">
      <div className="flex items-center gap-1.5 text-[11px] text-text-faint">
        <Icon size={13} /> {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-text">{value}</div>
    </div>
  );
}
