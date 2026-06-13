import { useState } from "react";
import { motion } from "framer-motion";
import { Globe, List, BarChart3, Settings, HelpCircle, FileCode2 } from "lucide-react";
import { cn } from "../lib/utils";
import { springSoft } from "../lib/motion";
import { useT } from "../../core/i18n/useT";
import type { MessageKey } from "../../core/i18n";

export type Screen = "connection" | "servers" | "stats" | "editor" | "settings";

const labelTransition = { duration: 0.2 };

const NAV: { id: Screen; icon: React.ElementType; labelKey: MessageKey }[] = [
  { id: "connection", icon: Globe, labelKey: "nav.connection" },
  { id: "servers", icon: List, labelKey: "nav.servers" },
  { id: "stats", icon: BarChart3, labelKey: "nav.stats" },
  { id: "editor", icon: FileCode2, labelKey: "nav.editor" },
  { id: "settings", icon: Settings, labelKey: "nav.settings" },
];

export function Sidebar({
  active,
  onNavigate,
}: {
  active: Screen;
  onNavigate: (s: Screen) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const navAnimate = { width: expanded ? 200 : 64 };
  const t = useT();

  // A fixed 64px rail keeps the layout stable; the expanding menu floats over
  // the main content instead of pushing it, so tile grids never reflow on hover.
  return (
    <div className="relative z-20 w-16 shrink-0">
      <motion.nav
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        animate={navAnimate}
        transition={springSoft}
        className="glass absolute inset-y-0 left-0 flex flex-col gap-1 overflow-hidden border-r border-border/60 p-3"
      >
        {NAV.map((item) => (
          <NavButton
            key={item.id}
            icon={item.icon}
            label={t(item.labelKey)}
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
