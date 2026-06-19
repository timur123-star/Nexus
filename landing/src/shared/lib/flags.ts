/**
 * Best-effort country detection from a server name or hostname.
 *
 * Returns a lowercase ISO 3166-1 alpha-2 code (e.g. "ru", "de") suitable for the
 * <Flag> component / flag-icons, or null when nothing matches.
 *
 * Detection order:
 *   1. an explicit flag emoji already present in the name
 *   2. a country / city word in the name
 *   3. a country / city word in the address
 *   4. a country-code TLD in the hostname
 */

const NAME_TO_ISO: Record<string, string> = {
  // Russia / CIS
  russia: "ru",
  россия: "ru",
  ru: "ru",
  moscow: "ru",
  москва: "ru",
  spb: "ru",
  питер: "ru",
  ukraine: "ua",
  ua: "ua",
  kyiv: "ua",
  kiev: "ua",
  украина: "ua",
  kazakhstan: "kz",
  kz: "kz",
  казахстан: "kz",
  // Europe
  france: "fr",
  франция: "fr",
  fr: "fr",
  paris: "fr",
  париж: "fr",
  germany: "de",
  германия: "de",
  de: "de",
  frankfurt: "de",
  франкфурт: "de",
  berlin: "de",
  netherlands: "nl",
  nl: "nl",
  amsterdam: "nl",
  нидерланды: "nl",
  голландия: "nl",
  finland: "fi",
  fi: "fi",
  helsinki: "fi",
  финляндия: "fi",
  sweden: "se",
  se: "se",
  stockholm: "se",
  швеция: "se",
  poland: "pl",
  pl: "pl",
  warsaw: "pl",
  польша: "pl",
  uk: "gb",
  "united kingdom": "gb",
  london: "gb",
  gb: "gb",
  britain: "gb",
  англия: "gb",
  лондон: "gb",
  italy: "it",
  it: "it",
  milan: "it",
  италия: "it",
  spain: "es",
  es: "es",
  madrid: "es",
  испания: "es",
  switzerland: "ch",
  ch: "ch",
  zurich: "ch",
  швейцария: "ch",
  austria: "at",
  at: "at",
  vienna: "at",
  австрия: "at",
  norway: "no",
  no: "no",
  oslo: "no",
  норвегия: "no",
  romania: "ro",
  ro: "ro",
  bucharest: "ro",
  румыния: "ro",
  ireland: "ie",
  ie: "ie",
  dublin: "ie",
  ирландия: "ie",
  // Americas
  usa: "us",
  us: "us",
  "united states": "us",
  america: "us",
  сша: "us",
  америка: "us",
  canada: "ca",
  ca: "ca",
  toronto: "ca",
  канада: "ca",
  brazil: "br",
  br: "br",
  бразилия: "br",
  // Asia / Pacific / ME
  japan: "jp",
  jp: "jp",
  tokyo: "jp",
  япония: "jp",
  токио: "jp",
  singapore: "sg",
  sg: "sg",
  сингапур: "sg",
  hongkong: "hk",
  hk: "hk",
  "hong kong": "hk",
  гонконг: "hk",
  korea: "kr",
  kr: "kr",
  seoul: "kr",
  корея: "kr",
  india: "in",
  in: "in",
  mumbai: "in",
  индия: "in",
  turkey: "tr",
  tr: "tr",
  istanbul: "tr",
  турция: "tr",
  стамбул: "tr",
  iran: "ir",
  ir: "ir",
  tehran: "ir",
  иран: "ir",
  australia: "au",
  au: "au",
  sydney: "au",
  австралия: "au",
  uae: "ae",
  ae: "ae",
  dubai: "ae",
  дубай: "ae",
  оаэ: "ae",
  israel: "il",
  il: "il",
  израиль: "il",
  china: "cn",
  cn: "cn",
  китай: "cn",
  vietnam: "vn",
  vn: "vn",
  вьетнам: "vn",
};

/** Country-code TLDs we are confident about for hostname-based detection. */
const TLD_TO_ISO: Record<string, string> = {
  ru: "ru",
  ua: "ua",
  kz: "kz",
  de: "de",
  fr: "fr",
  nl: "nl",
  fi: "fi",
  se: "se",
  pl: "pl",
  uk: "gb",
  it: "it",
  es: "es",
  ch: "ch",
  at: "at",
  no: "no",
  ro: "ro",
  ie: "ie",
  ca: "ca",
  br: "br",
  jp: "jp",
  sg: "sg",
  hk: "hk",
  kr: "kr",
  in: "in",
  tr: "tr",
  ir: "ir",
  au: "au",
  ae: "ae",
  il: "il",
  cn: "cn",
  vn: "vn",
  us: "us",
};

function matchDict(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [word, iso] of Object.entries(NAME_TO_ISO)) {
    if (new RegExp(`(^|[^a-zа-я])${word}([^a-zа-я]|$)`, "iu").test(lower)) {
      return iso;
    }
  }
  return null;
}

/** Convert an emoji flag back to its ISO code, if one is present in the name. */
function emojiToIso(name: string): string | null {
  const m = name.match(/\p{Regional_Indicator}{2}/u);
  if (!m) return null;
  const chars = [...m[0]].map((c) => String.fromCharCode((c.codePointAt(0) ?? 0) - 0x1f1e6 + 97));
  return chars.join("");
}

/**
 * Resolve a lowercase ISO country code from a server name and optional address.
 * Returns null when nothing matches (caller should show a neutral globe).
 */
export function isoFor(name: string, address?: string): string | null {
  const fromEmoji = emojiToIso(name);
  if (fromEmoji) return fromEmoji;

  const fromName = matchDict(name);
  if (fromName) return fromName;

  if (address) {
    const fromAddr = matchDict(address);
    if (fromAddr) return fromAddr;
    const tld = address.toLowerCase().match(/\.([a-z]{2})(?::\d+)?$/);
    if (tld && TLD_TO_ISO[tld[1]]) return TLD_TO_ISO[tld[1]];
  }
  return null;
}

/** ISO 3166-1 alpha-2 → regional-indicator emoji (kept for non-DOM contexts). */
export function isoToFlag(iso: string): string {
  if (iso.length !== 2) return "🌐";
  const base = 0x1f1e6;
  const a = iso.toUpperCase().charCodeAt(0) - 65;
  const b = iso.toUpperCase().charCodeAt(1) - 65;
  if (a < 0 || a > 25 || b < 0 || b > 25) return "🌐";
  return String.fromCodePoint(base + a, base + b);
}

/** Legacy emoji helper — emoji flags do NOT render on Windows; prefer <Flag>. */
export function flagFor(name: string, address?: string): string {
  const iso = isoFor(name, address);
  return iso ? isoToFlag(iso) : "🌐";
}
