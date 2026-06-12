import { useState } from "react";
import { Globe, List, BarChart3, Settings, HelpCircle, FileCode2 } from "lucide-react";
import { cn } from "../lib/utils";

export type Screen = "connection" | "servers" | "stats" | "editor" | "settings";

const NAV: { id: Screen; icon: React.ElementType; label: string }[] = [
  { id: "connection", icon: Globe, label: "Подключение" },
  { id: "servers", icon: List, label: "Серверы" },
  { id: "stats", icon: BarChart3, label: "Статистика" },
  { id: "editor", icon: FileCode2, label: "Редактор" },
  { id: "settings", icon: Settings, label: "Настройки" },
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
    <nav
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      className={cn(
        "glass z-10 flex shrink-0 flex-col gap-1 border-r border-border/60 p-3 transition-[width] duration-200",
        expanded ? "w-[200px]" : "w-[64px]",
      )}
      style={{ transitionTimingFunction: "var(--ease-out)" }}
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
        label="Справка"
        expanded={expanded}
        active={false}
        onClick={() => window.open("https://sing-box.sagernet.org/", "_blank")}
      />
    </nav>
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
      {active && <span className="absolute left-0 h-5 w-[3px] rounded-r bg-indigo" />}
      <Icon size={19} className="shrink-0" />
      <span
        className={cn(
          "whitespace-nowrap transition-opacity duration-200",
          expanded ? "opacity-100" : "opacity-0",
        )}
      >
        {label}
      </span>
    </button>
  );
}
