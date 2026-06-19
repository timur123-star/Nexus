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

/** Localisable suffixes for {@link formatUptime}. */
export interface UptimeUnits {
  /** Hour suffix, e.g. "h". */
  h: string;
  /** Minute suffix, e.g. "m". */
  m: string;
  /** Second suffix, e.g. "s". */
  s: string;
}

/** Russian defaults kept for callers that do not pass localised units. */
export const DEFAULT_UPTIME_UNITS: UptimeUnits = {
  h: "\u0447",
  m: "\u043c",
  s: "\u0441",
};

/** "1h 23m", "45s" \u2014 compact uptime with localisable unit suffixes. */
export function formatUptime(ms: number, units: UptimeUnits = DEFAULT_UPTIME_UNITS): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h}${units.h} ${m}${units.m}`;
  if (m > 0) return `${m}${units.m} ${sec}${units.s}`;
  return `${sec}${units.s}`;
}

/** Latency \u2192 semantic colour token. */
export function latencyColor(ms: number | null | undefined): string {
  if (ms == null) return "text-text-faint";
  if (ms < 0) return "text-bad";
  if (ms < 80) return "text-ok";
  if (ms < 200) return "text-warn";
  return "text-bad";
}

export function latencyLabel(ms: number | null | undefined): string {
  if (ms == null) return "\u2014";
  if (ms < 0) return "timeout";
  return `${ms} ms`;
}
