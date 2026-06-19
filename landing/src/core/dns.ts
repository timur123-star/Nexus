/**
 * Lightweight DNS-query extraction from core (sing-box/xray) log lines.
 *
 * Cores emit DNS activity in their logs; we surface a clean per-domain feed in
 * the Stats screen without needing a separate DNS API. Pure and unit-tested.
 */
export interface DnsEntry {
  ts: number;
  domain: string;
  result?: string;
  raw: string;
}

const DOMAIN_PATTERNS = [
  /(?:query|lookup|exchanged|resolve[d]?)[^A-Za-z0-9]+([A-Za-z0-9._-]+\.[A-Za-z]{2,})/i,
  /domain[=:\s]+([A-Za-z0-9._-]+\.[A-Za-z]{2,})/i,
  /\b([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9-]+)+\.[A-Za-z]{2,})\b/,
];

const IP_PATTERN = /((?:\d{1,3}\.){3}\d{1,3}|(?:[0-9a-fA-F]{1,4}:){2,}[0-9a-fA-F]{1,4})/;

/** Parse a single log line into a DnsEntry, or null if it is not DNS-related. */
export function parseDnsLine(line: string, now: number): DnsEntry | null {
  if (!/dns/i.test(line)) return null;
  for (const re of DOMAIN_PATTERNS) {
    const match = line.match(re);
    if (match) {
      const ip = line.match(IP_PATTERN);
      return { ts: now, domain: match[1], result: ip?.[1], raw: line };
    }
  }
  return null;
}

/** Parse many log lines, keeping only DNS entries in order. */
export function parseDnsLog(lines: string[], now: number = Date.now()): DnsEntry[] {
  const out: DnsEntry[] = [];
  for (const line of lines) {
    const entry = parseDnsLine(line, now);
    if (entry) out.push(entry);
  }
  return out;
}
