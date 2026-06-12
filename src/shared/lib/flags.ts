/**
 * Best-effort country flag inference from a server name or hostname.
 * Looks for an ISO code, a country word, or a flag emoji already present.
 */

const NAME_TO_ISO: Record<string, string> = {
  russia: "RU", россия: "RU", ru: "RU", москва: "RU", moscow: "RU",
  france: "FR", франция: "FR", fr: "FR", paris: "FR", париж: "FR",
  germany: "DE", германия: "DE", de: "DE", frankfurt: "DE",
  netherlands: "NL", nl: "NL", amsterdam: "NL",
  usa: "US", us: "US", "united states": "US", america: "US",
  uk: "GB", "united kingdom": "GB", london: "GB", gb: "GB",
  japan: "JP", jp: "JP", tokyo: "JP",
  singapore: "SG", sg: "SG",
  finland: "FI", fi: "FI", helsinki: "FI",
  sweden: "SE", se: "SE",
  turkey: "TR", tr: "TR", istanbul: "TR",
  hongkong: "HK", hk: "HK", "hong kong": "HK",
  iran: "IR", ir: "IR",
  poland: "PL", pl: "PL",
  ukraine: "UA", ua: "UA",
};

/** ISO 3166-1 alpha-2 → regional-indicator emoji. */
export function isoToFlag(iso: string): string {
  if (iso.length !== 2) return "🌐";
  const base = 0x1f1e6;
  const a = iso.toUpperCase().charCodeAt(0) - 65;
  const b = iso.toUpperCase().charCodeAt(1) - 65;
  if (a < 0 || a > 25 || b < 0 || b > 25) return "🌐";
  return String.fromCodePoint(base + a, base + b);
}

export function flagFor(name: string): string {
  // Already contains a flag emoji?
  const emoji = name.match(/\p{Regional_Indicator}{2}/u);
  if (emoji) return emoji[0];

  const lower = name.toLowerCase();
  for (const [word, iso] of Object.entries(NAME_TO_ISO)) {
    if (new RegExp(`(^|[^a-z])${word}([^a-z]|$)`, "i").test(lower)) {
      return isoToFlag(iso);
    }
  }
  return "🌐";
}
