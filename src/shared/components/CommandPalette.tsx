import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Search,
  Globe,
  List,
  BarChart3,
  History,
  ScrollText,
  Settings,
  FileCode2,
  Power,
  Download,
  Gauge,
  Sun,
  Moon,
  CornerDownLeft,
} from "lucide-react";
import { cn } from "../lib/utils";
import type { Screen } from "./Sidebar";
import { useConnectionStore } from "../../store/useConnectionStore";
import { useServerStore } from "../../store/useServerStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import type { Lang } from "../../core/i18n";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: React.ElementType;
  keywords: string;
  run: () => void;
}

const UI: Record<Lang, { placeholder: string; empty: string; nav: string; actions: string }> = {
  en: { placeholder: "Type a command or search…", empty: "No matching commands", nav: "Go to", actions: "Actions" },
  ru: { placeholder: "Команда или поиск…", empty: "Ничего не найдено", nav: "Перейти", actions: "Действия" },
  fa: { placeholder: "یک فرمان یا جستجو…", empty: "موردی یافت نشد", nav: "برو به", actions: "اقدامات" },
  zh: { placeholder: "输入命令或搜索…", empty: "未找到命令", nav: "前往", actions: "操作" },
};

const NAV_LABELS: Record<Lang, Record<Screen, string>> = {
  en: { connection: "Connection", servers: "Servers", stats: "Statistics", history: "History", logs: "Logs", editor: "Config editor", settings: "Settings" },
  ru: { connection: "Подключение", servers: "Серверы", stats: "Статистика", history: "История", logs: "Логи", editor: "Редактор конфигурации", settings: "Настройки" },
  fa: { connection: "اتصال", servers: "سرورها", stats: "آمار", history: "تاریخچه", logs: "گزارش‌ها", editor: "ویرایشگر پیکربندی", settings: "تنظیمات" },
  zh: { connection: "连接", servers: "服务器", stats: "统计", history: "历史", logs: "日志", editor: "配置编辑器", settings: "设置" },
};

const ACTION_LABELS: Record<Lang, { connect: string; disconnect: string; import: string; speed: string; light: string; dark: string }> = {
  en: { connect: "Connect", disconnect: "Disconnect", import: "Import servers", speed: "Run speed test", light: "Light theme", dark: "Dark theme" },
  ru: { connect: "Подключиться", disconnect: "Отключиться", import: "Импорт серверов", speed: "Тест скорости", light: "Светлая тема", dark: "Тёмная тема" },
  fa: { connect: "اتصال", disconnect: "قطع اتصال", import: "وارد کردن سرورها", speed: "تست سرعت", light: "تم روشن", dark: "تم تیره" },
  zh: { connect: "连接", disconnect: "断开连接", import: "导入服务器", speed: "速度测试", light: "浅色主题", dark: "深色主题" },
};

const NAV_ICONS: Record<Screen, React.ElementType> = {
  connection: Globe,
  servers: List,
  stats: BarChart3,
  history: History,
  logs: ScrollText,
  editor: FileCode2,
  settings: Settings,
};

const NAV_ORDER: Screen[] = ["connection", "servers", "stats", "history", "logs", "editor", "settings"];

export function CommandPalette({
  open,
  onClose,
  onNavigate,
  onImport,
  onToggleConnection,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (s: Screen) => void;
  onImport: () => void;
  onToggleConnection: () => void;
}) {
  const lang = useSettingsStore((s) => s.app.language) as Lang;
  const setApp = useSettingsStore((s) => s.setApp);
  const status = useConnectionStore((s) => s.status);
  const serverCount = useServerStore((s) => s.servers.length);
  const connected = status === "connected" || status === "reconnecting";

  const ui = UI[lang] ?? UI.en;
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(() => {
    const navL = NAV_LABELS[lang] ?? NAV_LABELS.en;
    const actL = ACTION_LABELS[lang] ?? ACTION_LABELS.en;
    const ui2 = UI[lang] ?? UI.en;
    const nav: Command[] = NAV_ORDER.map((screen) => ({
      id: `nav-${screen}`,
      label: navL[screen],
      hint: ui2.nav,
      icon: NAV_ICONS[screen],
      keywords: `${navL[screen]} ${screen}`,
      run: () => onNavigate(screen),
    }));
    const actions: Command[] = [
      ...(serverCount > 0
        ? [
            {
              id: "toggle",
              label: connected ? actL.disconnect : actL.connect,
              hint: ui2.actions,
              icon: Power,
              keywords: `${actL.connect} ${actL.disconnect} vpn`,
              run: onToggleConnection,
            },
          ]
        : []),
      {
        id: "import",
        label: actL.import,
        hint: ui2.actions,
        icon: Download,
        keywords: `${actL.import} subscription link qr`,
        run: onImport,
      },
      {
        id: "speed",
        label: actL.speed,
        hint: ui2.actions,
        icon: Gauge,
        keywords: `${actL.speed} speed test download upload`,
        run: () => onNavigate("stats"),
      },
      {
        id: "theme-dark",
        label: actL.dark,
        hint: ui2.actions,
        icon: Moon,
        keywords: `${actL.dark} theme`,
        run: () => setApp({ theme: "dark" }),
      },
      {
        id: "theme-light",
        label: actL.light,
        hint: ui2.actions,
        icon: Sun,
        keywords: `${actL.light} theme`,
        run: () => setApp({ theme: "light" }),
      },
    ];
    return [...actions, ...nav];
  }, [lang, connected, serverCount, onNavigate, onImport, onToggleConnection, setApp]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => `${c.label} ${c.keywords}`.toLowerCase().includes(q));
  }, [commands, query]);

  // Reset state and focus the input each time the palette opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      // Focus after the enter animation kicks in.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setSel(0);
  }, [query]);

  function choose(cmd: Command | undefined) {
    if (!cmd) return;
    onClose();
    cmd.run();
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(filtered.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(filtered[sel]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-start justify-center pt-[14vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            className="glass-elev relative z-[1] w-[min(92vw,560px)] overflow-hidden rounded-card border border-border/70 shadow-2xl"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
              <Search size={16} className="shrink-0 text-text-faint" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKey}
                placeholder={ui.placeholder}
                className="w-full bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
              />
              <kbd className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-faint">ESC</kbd>
            </div>
            <div className="max-h-[46vh] overflow-y-auto p-2">
              {filtered.length === 0 && (
                <p className="py-8 text-center text-sm text-text-faint">{ui.empty}</p>
              )}
              {filtered.map((cmd, i) => {
                const Icon = cmd.icon;
                return (
                  <button
                    key={cmd.id}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => choose(cmd)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-btn px-3 py-2 text-left text-sm transition-colors",
                      i === sel ? "bg-indigo/15 text-text" : "text-text-dim hover:bg-surface",
                    )}
                  >
                    <Icon size={16} className={cn("shrink-0", i === sel ? "text-indigo" : "text-text-faint")} />
                    <span className="flex-1 truncate">{cmd.label}</span>
                    {cmd.hint && <span className="text-[10px] uppercase tracking-wide text-text-faint">{cmd.hint}</span>}
                    {i === sel && <CornerDownLeft size={13} className="text-text-faint" />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
