import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware className combiner. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Human-readable bytes (1536 -> "1.5 KB"). */
export function formatBytes(bytes: number, perSecond = false): string {
  const suffix = perSecond ? "/s" : "";
  if (bytes < 1) return `0 B${suffix}`;
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(val >= 100 || i === 0 ? 0 : 1)} ${units[i]}${suffix}`;
}

/** "1h 23m", "45s" — compact uptime. */
export function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}ч ${m}м`;
  if (m > 0) return `${m}м ${sec}с`;
  return `${sec}с`;
}

/** Latency → semantic colour token. */
export function latencyColor(ms: number | null | undefined): string {
  if (ms == null) return "text-text-faint";
  if (ms < 0) return "text-bad";
  if (ms < 80) return "text-ok";
  if (ms < 200) return "text-warn";
  return "text-bad";
}

export function latencyLabel(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 0) return "timeout";
  return `${ms} ms`;
}
