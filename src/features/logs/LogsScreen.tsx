import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  FolderOpen,
  Info,
  ScrollText,
  Search,
  Trash2,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { coreLogRing } from "../../shared/hooks/useCoreEvents";
import { openLogsDir } from "../../core/ipc";
import { useSettingsStore } from "../../store/useSettingsStore";
import { CustomSelect } from "../../shared/components/CustomSelect";
import { cn } from "../../shared/lib/utils";
import type { Lang } from "../../core/i18n";

type Level = "error" | "warn" | "info" | "debug";
type LevelFilter = "all" | "info" | "warn" | "error";

interface LogRow {
  time: string;
  level: Level;
  module: string;
  message: string;
}

// Heuristic level detection covering both sing-box (INFO/WARN/ERROR words) and
// Xray ([Info]/[Warning]/[Error]) log formats.
function classify(line: string): Level {
  if (/\berror\b|\bfatal\b|\bpanic\b|\[error\]/i.test(line)) return "error";
  if (/\bwarn(ing)?\b|\[warning\]/i.test(line)) return "warn";
  if (/\bdebug\b|\btrace\b|\[debug\]/i.test(line)) return "debug";
  return "info";
}

const TIME_RE = /\b(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\b/;
const LEVEL_WORD_RE = /\b(info|warn(?:ing)?|error|fatal|panic|debug|trace)\b|\[(?:info|warning|warn|error|debug|trace)\]/i;
const MODULE_RE = /(?:^|\s)([a-z][a-z0-9/_.-]{1,15}):\s/i;

// Pull HH:MM:SS(.mmm) out of a line, else fall back to a dash.
function extractTime(line: string): string {
  const m = line.match(TIME_RE);
  return m ? m[1] : "—";
}

function parseLine(line: string): LogRow {
  const time = extractTime(line);
  const level = classify(line);

  // Strip the leading timestamp + level so the remainder is "module: message".
  let rest = line;
  if (time !== "—") rest = rest.replace(time, "");
  rest = rest.replace(LEVEL_WORD_RE, "").replace(/^[\s|:-]+/, "");

  // Module tag: first `word:` token (sing-box style) or bracketed `[tag]`.
  let module = "CORE";
  let message = rest.trim();
  const colon = rest.match(MODULE_RE);
  if (colon) {
    module = colon[1].replace(/\/.*/, "").toUpperCase();
    message = rest.slice(rest.indexOf(colon[0]) + colon[0].length).trim();
  } else {
    const bracket = rest.match(/\[([a-z][a-z0-9_-]{1,11})\]/i);
    if (bracket) {
      module = bracket[1].toUpperCase();
      message = rest.replace(bracket[0], "").trim();
    }
  }
  if (!message) message = line.trim();
  return { time, level, module, message };
}

function matchesFilter(level: Level, filter: LevelFilter): boolean {
  if (filter === "all") return true;
  if (filter === "info") return level === "info" || level === "debug";
  return level === filter;
}

const FILTERS: LevelFilter[] = ["all", "info", "warn", "error"];

const LEVEL_META: Record<Level, { icon: React.ElementType; text: string; bar: string; chip: string }> = {
  info: { icon: Info, text: "text-sky-400", bar: "bg-sky-400/70", chip: "text-sky-400" },
  warn: { icon: TriangleAlert, text: "text-warn", bar: "bg-warn/70", chip: "text-warn" },
  error: { icon: XCircle, text: "text-bad", bar: "bg-bad/70", chip: "text-bad" },
  debug: { icon: Info, text: "text-text-faint", bar: "bg-border", chip: "text-text-faint" },
};

const LOG_STRINGS: Record<Lang, Record<string, string>> = {
  en: {
    title: "Core logs", subtitle: "Live output from the running core",
    all: "All", info: "Info", warn: "Warnings", error: "Errors",
    search: "Search logs\u2026", empty: "No log output yet.",
    noMatch: "Nothing matches the current filter.",
    autoscroll: "Auto-scroll", copy: "Copy", copied: "Copied", clear: "Clear",
    openDir: "Open logs folder",
    colTime: "Time", colLevel: "Level", colModule: "Module", colMessage: "Message",
    levelInfo: "Info", levelWarn: "Warning", levelError: "Error", levelDebug: "Debug",
    perPage: "/ page",
  },
  ru: {
    title: "Логи ядра", subtitle: "Живой вывод работающего ядра",
    all: "Все", info: "Инфо", warn: "Предупреждения", error: "Ошибки",
    search: "Поиск по логам\u2026", empty: "Пока нет вывода.",
    noMatch: "Нет строк под текущий фильтр.",
    autoscroll: "Автопрокрутка", copy: "Копировать", copied: "Скопировано", clear: "Очистить",
    openDir: "Открыть папку логов",
    colTime: "Время", colLevel: "Уровень", colModule: "Модуль", colMessage: "Сообщение",
    levelInfo: "Инфо", levelWarn: "Предупреждение", levelError: "Ошибка", levelDebug: "Отладка",
    perPage: "/ стр.",
  },
  fa: {
    title: "گزارش‌های هسته", subtitle: "خروجی زندهٔ هستهٔ در حال اجرا",
    all: "همه", info: "اطلاعات", warn: "هشدارها", error: "خطاها",
    search: "جستجو در گزارش‌ها\u2026", empty: "هنوز خروجی‌ای نیست.",
    noMatch: "چیزی با فیلتر فعلی مطابقت ندارد.",
    autoscroll: "پیمایش خودکار", copy: "کپی", copied: "کپی شد", clear: "پاک کردن",
    openDir: "باز کردن پوشهٔ گزارش‌ها",
    colTime: "زمان", colLevel: "سطح", colModule: "ماژول", colMessage: "پیام",
    levelInfo: "اطلاعات", levelWarn: "هشدار", levelError: "خطا", levelDebug: "اشکال‌زدایی",
    perPage: "/ صفحه",
  },
  zh: {
    title: "核心日志", subtitle: "运行中核心的实时输出",
    all: "全部", info: "信息", warn: "警告", error: "错误",
    search: "搜索日志\u2026", empty: "暂无日志输出。",
    noMatch: "没有符合当前筛选的内容。",
    autoscroll: "自动滚动", copy: "复制", copied: "已复制", clear: "清空",
    openDir: "打开日志文件夹",
    colTime: "时间", colLevel: "级别", colModule: "模块", colMessage: "消息",
    levelInfo: "信息", levelWarn: "警告", levelError: "错误", levelDebug: "调试",
    perPage: "/ 页",
  },
};

const PAGE_SIZES = [20, 50, 100];
const GRID_COLS = "150px 170px 110px 1fr 36px";

export function LogsScreen() {
  const lang = useSettingsStore((s) => s.app.language);
  const ls = LOG_STRINGS[lang] ?? LOG_STRINGS.en;
  const [logs, setLogs] = useState<string[]>([]);
  const [filter, setFilter] = useState<LevelFilter>("all");
  const [query, setQuery] = useState("");
  const [autoscroll, setAutoscroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Poll the ring buffer; it mutates in place so a shallow copy each tick keeps
  // React state changes detectable.
  useEffect(() => {
    const tick = () => setLogs([...coreLogRing]);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Newest first — the ring buffer is chronological, so reverse for display.
  const rows = useMemo(() => logs.map(parseLine).reverse(), [logs]);

  const counts = useMemo(() => {
    const c = { all: rows.length, info: 0, warn: 0, error: 0 };
    for (const r of rows) {
      if (r.level === "error") c.error += 1;
      else if (r.level === "warn") c.warn += 1;
      else c.info += 1;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) => matchesFilter(r.level, filter) && (q === "" || r.message.toLowerCase().includes(q)),
    );
  }, [rows, filter, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);

  // Newest rows are first, so "auto-scroll" simply pins the view to page 1.
  useEffect(() => {
    if (autoscroll) setPage(1);
  }, [filtered.length, autoscroll]);
  useEffect(() => {
    setPage(1);
  }, [filter, query, pageSize]);

  const pageRows = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize],
  );

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(filtered.map((r) => r.message).join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const clear = () => {
    coreLogRing.length = 0;
    setLogs([]);
  };

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
              {ls[f]}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px] font-mono",
                  filter === f ? "bg-indigo/20" : "bg-surface text-text-faint",
                )}
              >
                {counts[f]}
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

      {/* Table */}
      <div className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-card">
        {/* Header row */}
        <div
          className="grid items-center gap-3 border-b border-border/60 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-faint"
          style={{ gridTemplateColumns: GRID_COLS }}
        >
          <span>{ls.colTime}</span>
          <span>{ls.colLevel}</span>
          <span>{ls.colModule}</span>
          <span>{ls.colMessage}</span>
          <span />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="mt-12 text-center text-sm text-text-faint">{ls.empty}</p>
          ) : pageRows.length === 0 ? (
            <p className="mt-12 text-center text-sm text-text-faint">{ls.noMatch}</p>
          ) : (
            pageRows.map((r, i) => {
              const meta = LEVEL_META[r.level];
              const LevelIcon = meta.icon;
              const levelLabel =
                r.level === "info"
                  ? ls.levelInfo
                  : r.level === "warn"
                    ? ls.levelWarn
                    : r.level === "error"
                      ? ls.levelError
                      : ls.levelDebug;
              return (
                <div
                  key={i}
                  className="relative grid items-center gap-3 border-b border-border/40 px-4 py-2.5 text-[12px] transition-colors hover:bg-surface/50"
                  style={{ gridTemplateColumns: GRID_COLS }}
                >
                  <span className={cn("absolute inset-y-0 left-0 w-[3px]", meta.bar)} />
                  <span className="font-mono text-text-dim">{r.time}</span>
                  <span className={cn("flex items-center gap-1.5 font-medium", meta.chip)}>
                    <LevelIcon size={13} /> {levelLabel}
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-wide text-text-faint">
                    {r.module}
                  </span>
                  <span className="truncate text-text-dim" title={r.message}>
                    {r.message}
                  </span>
                  <span className="flex justify-end text-text-faint">
                    <FileText size={13} />
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Pagination footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-2.5">
          <Pagination page={safePage} totalPages={totalPages} onChange={setPage} />
          <CustomSelect
            className="w-28"
            align="right"
            value={String(pageSize)}
            options={PAGE_SIZES.map((n) => ({ value: String(n), label: `${n} ${ls.perPage}` }))}
            onChange={(v) => setPageSize(Number(v))}
          />
        </div>
      </div>
    </div>
  );
}

/** Compact numbered pagination with leading/trailing ellipses. */
function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  const pages: (number | "…")[] = [];
  const add = (n: number | "…") => pages.push(n);
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) add(i);
  } else {
    add(1);
    if (page > 3) add("…");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) add(i);
    if (page < totalPages - 2) add("…");
    add(totalPages);
  }
  const btn =
    "grid h-8 min-w-8 place-items-center rounded-btn border px-2 text-xs transition-colors disabled:opacity-40";
  return (
    <div className="flex items-center gap-1.5">
      <button
        className={cn(btn, "border-border text-text-dim hover:text-text")}
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft size={14} />
      </button>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} className="px-1 text-xs text-text-faint">
            …
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={cn(
              btn,
              p === page
                ? "border-indigo bg-indigo/10 text-indigo"
                : "border-border text-text-dim hover:text-text",
            )}
          >
            {p}
          </button>
        ),
      )}
      <button
        className={cn(btn, "border-border text-text-dim hover:text-text")}
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}
