import { useState } from "react";
import { motion } from "framer-motion";
import { Globe, List, BarChart3, History, ScrollText, Settings, HelpCircle, FileCode2 } from "lucide-react";
import { cn } from "../lib/utils";
import { springSoft } from "../lib/motion";
import { useT } from "../../core/i18n/useT";
import { useSettingsStore } from "../../store/useSettingsStore";
import type { Lang } from "../../core/i18n";

export type Screen = "connection" | "servers" | "stats" | "history" | "logs" | "editor" | "settings";

const labelTransition = { duration: 0.2 };

// "History" and "Logs" have no keys in the global dictionary (kept untouched for
// the i18n parity test), so their labels resolve from these inline maps.
const HISTORY_LABEL: Record<Lang, string> = {
  en: "History",
  ru: "История",
  fa: "تاریخچه",
  zh: "历史",
};
const LOGS_LABEL: Record<Lang, string> = {
  en: "Logs",
  ru: "Логи",
  fa: "گزارش‌ها",
  zh: "日志",
};

export function Sidebar({
  active,
  onNavigate,
}: {
  active: Screen;
  onNavigate: (s: Screen) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const navAnimate = { width: expanded ? 208 : 64 };
  const t = useT();
  const lang = useSettingsStore((s) => s.app.language);

  const nav: { id: Screen; icon: React.ElementType; label: string }[] = [
    { id: "connection", icon: Globe, label: t("nav.connection") },
    { id: "servers", icon: List, label: t("nav.servers") },
    { id: "stats", icon: BarChart3, label: t("nav.stats") },
    { id: "history", icon: History, label: HISTORY_LABEL[lang] ?? HISTORY_LABEL.en },
    { id: "logs", icon: ScrollText, label: LOGS_LABEL[lang] ?? LOGS_LABEL.en },
    { id: "editor", icon: FileCode2, label: t("nav.editor") },
    { id: "settings", icon: Settings, label: t("nav.settings") },
  ];

  // A fixed 64px rail keeps the layout stable; the expanding menu floats over
  // the main content instead of pushing it, so tile grids never reflow on hover.
  // While expanded it becomes a near-opaque elevated drawer (plus a strong drop
  // shadow) so page content never bleeds through the labels.
  return (
    <div className="relative z-30 w-16 shrink-0">
      <motion.nav
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        animate={navAnimate}
        transition={springSoft}
        style={expanded ? { background: "color-mix(in srgb, var(--color-bg-elev) 97%, transparent)" } : undefined}
        className={cn(
          "glass-elev absolute inset-y-0 left-0 flex flex-col gap-1 overflow-hidden border-r border-border/60 p-3",
          expanded && "shadow-2xl",
        )}
      >
        {nav.map((item) => (
          <NavButton
            key={item.id}
            icon={item.icon}
            label={item.label}
            expanded={expanded}
            active={active === item.id}
            onClick={() => onNavigate(item.id)}
          />
        ))}

        <div className="flex-1" />

        <NavButton
          icon={HelpCircle}
          label={t("nav.help")}
          expanded={expanded}
          active={false}
          onClick={() => window.open("https://sing-box.sagernet.org/", "_blank")}
        />
      </motion.nav>
    </div>
  );
}

function NavButton({
  icon: Icon,
  label,
  expanded,
  active,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  expanded: boolean;
  active: boolean;
  onClick: () => void;
}) {
  const labelAnimate = { opacity: expanded ? 1 : 0 };
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        "relative flex h-10 items-center gap-3 overflow-hidden rounded-btn px-[11px] text-sm transition-colors",
        active
          ? "bg-indigo/15 text-indigo"
          : "text-text-dim hover:bg-surface hover:text-text",
      )}
    >
      {active && (
        <motion.span
          layoutId="nav-active"
          transition={springSoft}
          className="absolute left-0 h-5 w-[3px] rounded-r bg-indigo"
        />
      )}
      <Icon size={19} className="shrink-0" />
      <motion.span animate={labelAnimate} transition={labelTransition} className="whitespace-nowrap">
        {label}
      </motion.span>
    </button>
  );
}
