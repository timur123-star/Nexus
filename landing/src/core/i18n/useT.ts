import { useSettingsStore } from "../../store/useSettingsStore";
import { translate, type Lang, type MessageKey } from "./index";

export type TFunction = (key: MessageKey, vars?: Record<string, string | number>) => string;

/**
 * React hook returning a translator bound to the active UI language. Re-renders
 * automatically when the user changes the language in settings.
 */
export function useT(): TFunction {
  const lang = useSettingsStore((s) => s.app.language) as Lang;
  return (key, vars) => translate(lang, key, vars);
}
