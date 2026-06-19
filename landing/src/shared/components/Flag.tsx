import { Globe2 } from "lucide-react";
import { cn } from "../lib/utils";
import { isoFor } from "../lib/flags";

/**
 * Renders a real SVG country flag (via flag-icons) inferred from a server name
 * and/or address.
 *
 * Why not emoji? Windows refuses to render regional-indicator flag emoji and
 * shows them as bare letter pairs (e.g. "RU") that are wider than expected and
 * wreck the surrounding flex layout. This component is a fixed-size box that
 * looks identical on every OS and never shifts neighbouring controls. When the
 * country cannot be inferred it falls back to a neutral globe glyph.
 */
export function Flag({
  name,
  address,
  size = 22,
  className,
}: {
  name: string;
  address?: string;
  size?: number;
  className?: string;
}) {
  const iso = isoFor(name, address);
  const w = size;
  const h = Math.round(size * 0.75);
  const boxStyle = { width: w, height: h };
  const flagStyle = { width: w, height: h, backgroundSize: "cover" };

  return (
    <span
      aria-hidden
      style={boxStyle}
      className={cn(
        "inline-grid shrink-0 place-items-center overflow-hidden rounded-[4px] bg-surface ring-1 ring-border/60",
        className,
      )}
    >
      {iso ? (
        <span className={cn("fi", `fi-${iso}`)} style={flagStyle} />
      ) : (
        <Globe2 size={Math.round(h * 0.82)} className="text-text-faint" />
      )}
    </span>
  );
}
