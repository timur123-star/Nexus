/**
 * Accent presets. The app's primary brand colour lives in two CSS variables
 * (`--color-indigo` / `--color-indigo-soft`) that every `indigo` Tailwind
 * utility resolves at runtime. Overriding them on documentElement re-tints the
 * whole UI instantly — the same cascade trick the `.light` theme uses — so we
 * never have to touch the compiled utility classes.
 *
 * Teal stays the fixed complementary colour (it also backs the `ok`/connected
 * status), so accent customisation only swaps the primary.
 */
export interface AccentPreset {
  id: string;
  base: string;
  soft: string;
}

export const ACCENTS: AccentPreset[] = [
  { id: "crimson", base: "#dc2626", soft: "#ef4444" },
  { id: "scarlet", base: "#e11d48", soft: "#fb7185" },
  { id: "ember", base: "#f97316", soft: "#fb923c" },
  { id: "amber", base: "#f59e0b", soft: "#fbbf24" },
  { id: "violet", base: "#8b5cf6", soft: "#a78bfa" },
  { id: "indigo", base: "#5b6af0", soft: "#7d88f4" },
  { id: "blue", base: "#3b82f6", soft: "#60a5fa" },
  { id: "cyan", base: "#06b6d4", soft: "#22d3ee" },
  { id: "emerald", base: "#10b981", soft: "#34d399" },
];

export const DEFAULT_ACCENT = "crimson";

/** Re-tint the primary accent by overriding the brand CSS variables. */
export function applyAccent(id: string): void {
  const preset = ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
  const root = document.documentElement;
  root.style.setProperty("--color-indigo", preset.base);
  root.style.setProperty("--color-indigo-soft", preset.soft);
}
