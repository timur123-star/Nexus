/**
 * Pure translation core — no React or store imports, so it stays trivially
 * unit-testable. The `useT` hook (which binds to the settings store) lives in
 * `useT.ts` to keep this module side-effect free.
 */
import { en, fa, ru, zh, type Lang, type MessageKey } from "./messages";

export type { Lang, MessageKey } from "./messages";

const DICTS: Record<Lang, Partial<Record<MessageKey, string>>> = { en, ru, fa, zh };

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/**
 * Translate `key` for `lang`, falling back to English and finally to the raw
 * key. `vars` fills `{name}` placeholders.
 */
export function translate(
  lang: Lang,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const dict = DICTS[lang] ?? DICTS.en;
  const raw = dict[key] ?? DICTS.en[key] ?? key;
  return vars ? interpolate(raw, vars) : raw;
}
