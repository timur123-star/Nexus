import { useMemo } from "react";

/** Lightweight inline SVG sparkline — no chart dependency. */
export function Sparkline({
  data,
  width = 120,
  height = 32,
  color = "var(--color-teal)",
  fill = true,
  strokeWidth = 1.5,
  responsive = false,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  strokeWidth?: number;
  /** Stretch to fill the parent's width; `width` is then only the viewBox coordinate space. */
  responsive?: boolean;
}) {
  // All hooks must run unconditionally and in a stable order, so compute the
  // gradient id and the path geometry before any early return.
  const gid = useMemo(() => `sg-${Math.random().toString(36).slice(2, 8)}`, []);

  const { line, area } = useMemo(() => {
    if (data.length < 2) return { line: "", area: "" };
    const max = Math.max(...data, 1);
    const stepX = width / (data.length - 1);
    const pts = data.map((v, i) => {
      const x = i * stepX;
      const y = height - (v / max) * (height - 2) - 1;
      return [x, y] as const;
    });
    const line = pts
      .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
      .join(" ");
    const area = `${line} L${width},${height} L0,${height} Z`;
    return { line, area };
  }, [data, width, height]);

  // Responsive mode lets the graph stretch horizontally to its container so it
  // never overflows a narrow window; the numeric width stays the coordinate space.
  const svgWidth = responsive ? "100%" : width;
  const preserveAspectRatio = responsive ? "none" : undefined;

  // No data yet: instead of a blank box, draw a subtle dashed baseline so the
  // chart area reads as "idle / resting" rather than broken or empty.
  if (!line) {
    const baselineY = height - 1;
    return (
      <svg
        width={svgWidth}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio={preserveAspectRatio}
        className={responsive ? "block" : undefined}
      >
        <line
          x1={0}
          y1={baselineY}
          x2={width}
          y2={baselineY}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray="3 6"
          opacity={0.3}
        />
      </svg>
    );
  }

  return (
    <svg
      width={svgWidth}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={preserveAspectRatio}
      className={responsive ? "block" : undefined}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${gid})`} />}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
