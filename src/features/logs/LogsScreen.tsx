import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, Check, Copy, FolderOpen, ScrollText, Search, Trash2 } from "lucide-react";
import { coreLogRing } from "../../shared/hooks/useCoreEvents";
import { openLogsDir } from "../../core/ipc";
import { useSettingsStore } from "../../store/useSettingsStore";
import { cn } from "../../shared/lib/utils";
import type { Lang } from "../../core/i18n";

type Level = "error" | "warn" | "info" | "debug";
type LevelFilter = "all" | "info" | "warn" | "error";

// Heuristic level detection covering both sing-box (INFO/WARN/ERROR words) and
// Xray ([Info]/[Warning]/[Error]) log formats.
function classify(line: string): Level {
  if (/\berror\b|\bfatal\b|\bpanic\b|\[error\]/i.test(line)) return "error";
  if (/\bwarn(ing)?\b|\[warning\]/i.test(line)) return "warn";
  if (/\bdebug\b|\btrace\b|\[debug\]/i.test(line)) return "debug";
  return "info";
}

// Info filter also surfaces debug/trace lines so nothing is hidden under "all"
// alone.
function matchesFilter(level: Level, filter: LevelFilter): boolean {
  if (filter === "all") return true;
  if (filter === "info") return level === "info" || level === "debug";
  return level === filter;
}

const LEVEL_COLOR: Record<Level, string> = {
  error: "text-bad",
  warn: "text-warn",
  info: "text-text-dim",
  debug: "text-text-faint",
};

const FILTERS: LevelFilter[] = ["all", "info", "warn", "error"];

const LOG_STRINGS: Record<Lang, Record<string, string>> = {
  en: {
    title: "Core logs",
    subtitle: "Live output from the running core",
    all: "All",
    info: "Info",
    warn: "Warnings",
    error: "Errors",
    search: "Search logs\u2026",
    empty: "No log output yet.",
    noMatch: "Nothing matches the current filter.",
    autoscroll: "Auto-scroll",
    copy: "Copy",
    copied: "Copied",
    clear: "Clear",
    openDir: "Open logs folder",
  },
  ru: {
    title: "Логи ядра",
    subtitle: "Живой вывод работающего ядра",
    all: "Все",
    info: "Инфо",
    warn: "Предупреждения",
    error: "Ошибки",
    search: "Поиск по логам\u2026",
    empty: "Пока нет вывода.",
    noMatch: "Нет строк под текущий фильтр.",
    autoscroll: "Автопрокрутка",
    copy: "Копировать",
    copied: "Скопировано",
    clear: "Очистить",
    openDir: "Открыть папку логов",
  },
  fa: {
    title: "گزارش‌های هسته",
    subtitle: "خروجی زندهٔ هستهٔ در حال اجرا",
    all: "همه",
    info: "اطلاعات",
    warn: "هشدارها",
    error: "خطاها",
    search: "جستجو در گزارش‌ها\u2026",
    empty: "هنوز خروجی‌ای نیست.",
    noMatch: "چیزی با فیلتر فعلی مطابقت ندارد.",
    autoscroll: "پیمایش خودکار",
    copy: "کپی",
    copied: "کپی شد",
    clear: "پاک کردن",
    openDir: "باز کردن پوشهٔ گزارش‌ها",
  },
  zh: {
    title: "核心日志",
    subtitle: "运行中核心的实时输出",
    all: "全部",
    info: "信息",
    warn: "警告",
    error: "错误",
    search: "搜索日志\u2026",
    empty: "暂无日志输出。",
    noMatch: "没有符合当前筛选的内容。",
    autoscroll: "自动滚动",
    copy: "复制",
    copied: "已复制",
    clear: "清空",
    openDir: "打开日志文件夹",
  },
};

export function LogsScreen() {
  const lang = useSettingsStore((s) => s.app.language);
  const ls = LOG_STRINGS[lang] ?? LOG_STRINGS.en;
  const [logs, setLogs] = useState<string[]>([]);
  const [filter, setFilter] = useState<LevelFilter>("all");
  const [query, setQuery] = useState("");
  const [autoscroll, setAutoscroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Poll the ring buffer; it mutates in place so a shallow copy each tick keeps
  // React state changes detectable.
  useEffect(() => {
    const tick = () => setLogs([...coreLogRing]);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const counts = useMemo(() => {
    const c = { all: logs.length, info: 0, warn: 0, error: 0 };
    for (const line of logs) {
      const lvl = classify(line);
      if (lvl === "error") c.error += 1;
      else if (lvl === "warn") c.warn += 1;
      else c.info += 1;
    }
    return c;
  }, [logs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter(
      (line) =>
        matchesFilter(classify(line), filter) &&
        (q === "" || line.toLowerCase().includes(q)),
    );
  }, [logs, filter, query]);

  // Stick to the bottom (newest line) while auto-scroll is on.
  useEffect(() => {
    if (!autoscroll) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [filtered.length, autoscroll]);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(filtered.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable \u2014 ignore */
    }
  };

  const clear = () => {
    coreLogRing.length = 0;
    setLogs([]);
  };

  const filterLabel = (f: LevelFilter): string => ls[f];
  const filterCount = (f: LevelFilter): number => counts[f];

  return (
    <div className="flex h-full flex-col gap-4 p-5">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-btn bg-indigo/15 text-indigo">
            <ScrollText size={18} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-text">{ls.title}</h2>
            <p className="text-[11px] text-text-faint">{ls.subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setAutoscroll((v) => !v)}
            title={ls.autoscroll}
            className={cn(
              "flex items-center gap-1.5 rounded-btn border px-2.5 py-1.5 text-xs transition-colors",
              autoscroll
                ? "border-indigo bg-indigo/10 text-indigo"
                : "border-border text-text-dim hover:text-text",
            )}
          >
            <ArrowDownToLine size={14} /> {ls.autoscroll}
          </button>
          <button
            onClick={copyAll}
            title={ls.copy}
            className="flex items-center gap-1.5 rounded-btn border border-border px-2.5 py-1.5 text-xs text-text-dim transition-colors hover:text-text"
          >
            {copied ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
            {copied ? ls.copied : ls.copy}
          </button>
          <button
            onClick={() => void openLogsDir()}
            title={ls.openDir}
            className="grid h-8 w-8 place-items-center rounded-btn border border-border text-text-faint transition-colors hover:text-text"
          >
            <FolderOpen size={14} />
          </button>
          <button
            onClick={clear}
            title={ls.clear}
            className="grid h-8 w-8 place-items-center rounded-btn border border-border text-text-faint transition-colors hover:text-bad"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </header>

      <div className="flex items-center gap-2">
        <div className="flex gap-1.5">
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
                  filter === f ? "bg-indigo/20" : "bg-surface text-text-faint",
                )}
              >
                {filterCount(f)}
              </span>
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-64">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={ls.search}
            className="ns-input w-full pl-8"
          />
        </div>
      </div>

      <div
        ref={scrollRef}
        className="glass min-h-0 flex-1 overflow-y-auto rounded-card p-2 font-mono text-[11px] leading-relaxed"
      >
        {logs.length === 0 ? (
          <p className="mt-10 text-center text-text-faint">{ls.empty}</p>
        ) : filtered.length === 0 ? (
          <p className="mt-10 text-center text-text-faint">{ls.noMatch}</p>
        ) : (
          filtered.map((line, i) => {
            const lvl = classify(line);
            return (
              <div
                key={i}
                title={line}
                className={cn(
                  "whitespace-pre-wrap break-all rounded px-2 py-0.5",
                  LEVEL_COLOR[lvl],
                  lvl === "error" && "bg-bad/5",
                  lvl === "warn" && "bg-warn/5",
                )}
              >
                {line}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
