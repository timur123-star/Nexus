import { useState } from "react";
import { motion } from "framer-motion";
import { Globe, List, BarChart3, Settings, HelpCircle, FileCode2 } from "lucide-react";
import { cn } from "../lib/utils";
import { springSoft } from "../lib/motion";

export type Screen = "connection" | "servers" | "stats" | "editor" | "settings";

const NAV: { id: Screen; icon: React.ElementType; label: string }[] = [
  { id: "connection", icon: Globe, label: "\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435" },
  { id: "servers", icon: List, label: "\u0421\u0435\u0440\u0432\u0435\u0440\u044b" },
  { id: "stats", icon: BarChart3, label: "\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043a\u0430" },
  { id: "editor", icon: FileCode2, label: "\u0420\u0435\u0434\u0430\u043a\u0442\u043e\u0440" },
  { id: "settings", icon: Settings, label: "\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438" },
];

export function Sidebar({
  active,
  onNavigate,
}: {
  active: Screen;
  onNavigate: (s: Screen) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.nav
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      animate= width: expanded ? 200 : 64 
      transition={springSoft}
      className="glass z-10 flex shrink-0 flex-col gap-1 overflow-hidden border-r border-border/60 p-3"
    >
      {NAV.map((item) => (
        <NavButton
          key={item.id}
          {...item}
          expanded={expanded}
          active={active === item.id}
          onClick={() => onNavigate(item.id)}
        />
      ))}

      <div className="flex-1" />

      <NavButton
        id="help"
        icon={HelpCircle}
        label="\u0421\u043f\u0440\u0430\u0432\u043a\u0430"
        expanded={expanded}
        active={false}
        onClick={() => window.open("https://sing-box.sagernet.org/", "_blank")}
      />
    </motion.nav>
  );
}

function NavButton({
  icon: Icon,
  label,
  expanded,
  active,
  onClick,
}: {
  id: string;
  icon: React.ElementType;
  label: string;
  expanded: boolean;
  active: boolean;
  onClick: () => void;
}) {
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
      <motion.span
        animate= opacity: expanded ? 1 : 0 
        transition= duration: 0.2 
        className="whitespace-nowrap"
      >
        {label}
      </motion.span>
    </button>
  );
}
