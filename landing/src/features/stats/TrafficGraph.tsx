import { useId, useMemo } from "react";
import { formatBytes } from "../../shared/lib/utils";

const VW = 900; // viewBox width (coordinate space)
const VH = 200; // viewBox height
const ROWS = 4; // grid rows -> 5 labels (0..max)

/** Smooth a series into an SVG path (Catmull-Rom-ish via quadratic midpoints). */
function toPath(values: number[], max: number): string {
  if (values.length < 2) return "";
  const stepX = VW / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = i * stepX;
    const y = VH - (Math.min(v, max) / max) * (VH - 6) - 3;
    return [x, y] as const;
  });
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1];
    const [x, y] = pts[i];
    const mx = (px + x) / 2;
    d += ` Q${px.toFixed(1)},${py.toFixed(1)} ${mx.toFixed(1)},${((py + y) / 2).toFixed(1)}`;
    d += ` T${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return d;
}

/** Deterministic faint "resting" waveform shown when the tunnel is idle. */
function idleWave(): number[] {
  const n = 60;
  return Array.from({ length: n }, (_, i) => {
    const t = i / n;
    return (
      0.22 +
      0.05 * Math.sin(t * Math.PI * 9) +
      0.04 * Math.sin(t * Math.PI * 23 + 1.3) +
      0.03 * Math.sin(t * Math.PI * 4)
    );
  });
}

/**
 * Live traffic graph with a fixed Y axis (labels + gridlines) and a faint
 * dotted backdrop. Mirrors the design mockup: even when disconnected the chart
 * shows axis labels and a subtle resting waveform instead of an empty box.
 */
export function TrafficGraph({
  downSeries,
  upSeries,
  active,
}: {
  downSeries: number[];
  upSeries: number[];
  active: boolean;
}) {
  const gid = useId();

  const max = useMemo(() => {
    const peak = Math.max(0, ...downSeries, ...upSeries);
    if (peak <= 0) return 10 * 1024 * 1024; // 10 MB/s default, mirrors the mockup
    // Round up to a "nice" 1/2/5 × 10^k scale.
    const pow = Math.pow(10, Math.floor(Math.log10(peak)));
    const norm = peak / pow;
    const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return nice * pow * 1.15;
  }, [downSeries, upSeries]);

  const labels = useMemo(
    () => Array.from({ length: ROWS + 1 }, (_, i) => formatBytes((max * (ROWS - i)) / ROWS, true)),
    [max],
  );

  const hasData = downSeries.length >= 2 || upSeries.length >= 2;
  const downPath = useMemo(
    () => (hasData ? toPath(downSeries, max) : ""),
    [downSeries, max, hasData],
  );
  const upPath = useMemo(() => (hasData ? toPath(upSeries, max) : ""), [upSeries, max, hasData]);
  const idlePath = useMemo(
    () =>
      hasData
        ? ""
        : toPath(
            idleWave().map((v) => v * max),
            max,
          ),
    [hasData, max],
  );
  const idleArea = idlePath ? `${idlePath} L${VW},${VH} L0,${VH} Z` : "";
  const downArea = downPath ? `${downPath} L${VW},${VH} L0,${VH} Z` : "";

  return (
    <div className="flex gap-3">
      {/* Y-axis labels */}
      <div
        className="flex flex-col justify-between py-0.5 text-right text-[10px] font-mono text-text-faint"
        style={{ height: 150 }}
      >
        {labels.map((l, i) => (
          <span key={i} className="whitespace-nowrap leading-none">
            {l}
          </span>
        ))}
      </div>

      <div className="relative flex-1" style={{ height: 150 }}>
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${VW} ${VH}`}
          preserveAspectRatio="none"
          className="block"
        >
          <defs>
            <pattern id={`${gid}-dots`} width="14" height="14" patternUnits="userSpaceOnUse">
              <circle cx="1.2" cy="1.2" r="1.2" fill="var(--color-indigo)" opacity="0.12" />
            </pattern>
            <linearGradient id={`${gid}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-indigo)" stopOpacity="0.32" />
              <stop offset="100%" stopColor="var(--color-indigo)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Dotted backdrop */}
          <rect x="0" y="0" width={VW} height={VH} fill={`url(#${gid}-dots)`} />

          {/* Horizontal gridlines */}
          {Array.from({ length: ROWS + 1 }, (_, i) => {
            const y = (VH / ROWS) * i;
            return (
              <line
                key={i}
                x1="0"
                y1={y}
                x2={VW}
                y2={y}
                stroke="var(--color-border)"
                strokeWidth="1"
                strokeDasharray="4 8"
                opacity="0.5"
              />
            );
          })}

          {/* Idle resting waveform */}
          {idlePath && (
            <>
              <path d={idleArea} fill={`url(#${gid}-fill)`} opacity="0.5" />
              <path
                d={idlePath}
                fill="none"
                stroke="var(--color-indigo)"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={active ? 0.9 : 0.55}
              />
            </>
          )}

          {/* Live data */}
          {downArea && <path d={downArea} fill={`url(#${gid}-fill)`} />}
          {downPath && (
            <path
              d={downPath}
              fill="none"
              stroke="var(--color-teal)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {upPath && (
            <path
              d={upPath}
              fill="none"
              stroke="var(--color-indigo)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
        </svg>
      </div>
    </div>
  );
}
