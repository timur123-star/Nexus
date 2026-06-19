import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  AlertCircle,
  Download,
  RefreshCw,
  Copy,
  Check,
  Maximize2,
  Palette,
  Sun,
} from "lucide-react";
import { useServerStore } from "../../store/useServerStore";
import { useConnectionStore } from "../../store/useConnectionStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { toast } from "../../store/useToastStore";
import { getCore, ALL_CORES } from "../../core/proxy";
import { validateConfig } from "../../core/ipc";
import { CodeEditor } from "../../shared/components/CodeEditor";
import { CustomSelect } from "../../shared/components/CustomSelect";
import { useT } from "../../core/i18n/useT";
import type { CoreKind } from "../../core/types";
import type { Lang } from "../../core/i18n";

type EditorTheme = "nexus-dark" | "nexus-light";

// Editor toolbar + status-bar labels, inline so the global parity test stays untouched.
const ED_STRINGS: Record<
  Lang,
  {
    theme: string;
    dark: string;
    light: string;
    line: string;
    col: string;
    syntaxOk: string;
    syntaxBad: string;
    length: string;
    lines: string;
  }
> = {
  en: {
    theme: "Theme",
    dark: "Nexus Dark",
    light: "Nexus Light",
    line: "Line",
    col: "Col",
    syntaxOk: "Syntax OK",
    syntaxBad: "Syntax error",
    length: "Length",
    lines: "Lines",
  },
  ru: {
    theme: "Тема",
    dark: "Nexus Dark",
    light: "Nexus Light",
    line: "Строка",
    col: "Столбец",
    syntaxOk: "Синтаксис корректен",
    syntaxBad: "Ошибка синтаксиса",
    length: "Длина",
    lines: "Строк",
  },
  fa: {
    theme: "تم",
    dark: "Nexus Dark",
    light: "Nexus Light",
    line: "خط",
    col: "ستون",
    syntaxOk: "نحو درست است",
    syntaxBad: "خطای نحوی",
    length: "طول",
    lines: "خطوط",
  },
  zh: {
    theme: "主题",
    dark: "Nexus Dark",
    light: "Nexus Light",
    line: "行",
    col: "列",
    syntaxOk: "语法正确",
    syntaxBad: "语法错误",
    length: "长度",
    lines: "行数",
  },
};

// Inline label so the global dictionary (and its parity test) stays untouched.
const MODIFIED_LABEL: Record<Lang, string> = {
  en: "Modified",
  ru: "Изменено",
  fa: "ویرایش‌شده",
  zh: "已修改",
};

// Copy button + its success/failure toast, 4-language inline.
const COPY_STRINGS: Record<Lang, { copy: string; copied: string; failed: string }> = {
  en: { copy: "Copy", copied: "Config copied to clipboard", failed: "Couldn't copy config" },
  ru: {
    copy: "Копировать",
    copied: "Конфиг скопирован в буфер",
    failed: "Не удалось скопировать",
  },
  fa: {
    copy: "کپی",
    copied: "پیکربندی کپی شد",
    failed: "کپی نشد",
  },
  zh: { copy: "复制", copied: "配置已复制到剪贴板", failed: "复制失败" },
};

export function EditorScreen() {
  const t = useT();
  const servers = useServerStore((s) => s.servers);
  const activeId = useConnectionStore((s) => s.activeServerId);
  const proxy = useSettingsStore((s) => s.proxy);
  const lang = useSettingsStore((s) => s.app.language);
  const C = COPY_STRINGS[lang] ?? COPY_STRINGS.en;

  const active = servers.find((s) => s.id === activeId) ?? servers[0];

  // Generate exactly what the connection layer would run: same core selection
  // (with fallback for protocols the chosen core can't handle) and the full
  // option set — so the preview/export never drifts from reality.
  const generated = useMemo<{ text: string; core: CoreKind | null; error: string | null }>(() => {
    if (!active) return { text: "{}", core: null, error: null };
    let core = getCore(proxy.coreKind);
    if (!core.supports(active.protocol)) {
      const fallback = ALL_CORES.find((c) => c.supports(active.protocol));
      if (fallback) core = fallback;
    }
    try {
      const cfg = core.generateConfig(active, {
        mixedPort: proxy.mixedPort,
        clashApiPort: proxy.clashApiPort,
        clashSecret: proxy.clashSecret,
        routingMode: proxy.routingMode,
        tun: proxy.tun,
        allowLan: proxy.allowLan,
        fakeIp: proxy.fakeIp,
        dns: proxy.dns,
        customRules: proxy.customRules,
        blockQuic: proxy.blockQuic,
        mux: proxy.mux,
        fragment: proxy.fragment,
      });
      return { text: JSON.stringify(cfg, null, 2), core: core.kind, error: null };
    } catch (e) {
      return { text: "{}", core: core.kind, error: e instanceof Error ? e.message : String(e) };
    }
  }, [active, proxy]);

  const E = ED_STRINGS[lang] ?? ED_STRINGS.en;
  const [text, setText] = useState(generated.text);
  const [dirty, setDirty] = useState(false);
  const [check, setCheck] = useState<{ ok: boolean; error?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [editorTheme, setEditorTheme] = useState<EditorTheme>("nexus-dark");

  // Live, cheap syntax check for the status bar (independent of the core validator).
  const syntaxOk = useMemo(() => {
    try {
      JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  }, [text]);
  const lineCount = useMemo(() => text.split("\n").length, [text]);
  const sizeKb = useMemo(() => (new Blob([text]).size / 1024).toFixed(2), [text]);

  // Follow the generated config (active server / settings changes) until the
  // user starts editing by hand. Their manual edits are then preserved until
  // they explicitly press Regenerate.
  useEffect(() => {
    if (!dirty) setText(generated.text);
  }, [generated.text, dirty]);

  const handleChange = (v: string) => {
    setText(v);
    setDirty(true);
    setCheck(null);
  };

  const handleRegenerate = () => {
    setText(generated.text);
    setDirty(false);
    setCheck(null);
  };

  async function handleValidate() {
    setCheck(await validateConfig(text));
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(C.copied);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error(C.failed);
    }
  }

  function handleExport() {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nexusshield-${active?.name ?? "config"}.json`.replace(/[^\\w.-]+/g, "_");
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-full flex-col p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-text">{t("editor.title")}</h2>
          <p className="flex items-center gap-2 text-xs text-text-faint">
            {t("editor.subtitle", { name: active?.name ?? "\u2014" })}
            {generated.core && (
              <span className="rounded bg-indigo/15 px-1.5 py-0.5 font-mono text-indigo">
                {generated.core}
              </span>
            )}
            {dirty && (
              <span className="rounded bg-warn/15 px-1.5 py-0.5 font-medium text-warn">
                {MODIFIED_LABEL[lang] ?? MODIFIED_LABEL.en}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleRegenerate}
            disabled={!dirty}
            className="glass flex items-center gap-1.5 rounded-btn px-3 py-2 text-sm text-text-dim transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw size={14} /> {t("editor.regenerate")}
          </button>
          <button
            onClick={handleCopy}
            title={C.copy}
            className="glass flex items-center gap-1.5 rounded-btn px-3 py-2 text-sm text-text-dim transition-colors hover:text-text"
          >
            {copied ? <Check size={14} className="text-ok" /> : <Copy size={14} />} {C.copy}
          </button>
          <button
            onClick={handleValidate}
            className="glass flex items-center gap-1.5 rounded-btn px-3 py-2 text-sm text-text-dim hover:text-text"
          >
            <CheckCircle2 size={14} /> {t("editor.validate")}
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 rounded-btn bg-indigo px-3 py-2 text-sm font-medium text-white hover:bg-indigo-soft"
          >
            <Download size={14} /> {t("editor.export")}
          </button>
        </div>
      </div>

      {generated.error && (
        <div className="mb-2 flex items-center gap-2 rounded-btn bg-bad/10 px-3 py-2 text-xs text-bad">
          <AlertCircle size={14} /> {generated.error}
        </div>
      )}

      {check && (
        <div
          className={`mb-2 flex items-center gap-2 rounded-btn px-3 py-2 text-xs ${
            check.ok ? "bg-ok/10 text-ok" : "bg-bad/10 text-bad"
          }`}
        >
          {check.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
          {check.ok ? t("editor.valid") : check.error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-border">
        {/* Editor toolbar */}
        <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-bg-elev/30 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-text-faint">
              <Palette size={13} className="text-indigo" /> {E.theme}:
            </span>
            <CustomSelect
              className="w-40"
              value={editorTheme}
              options={[
                { value: "nexus-dark", label: E.dark },
                { value: "nexus-light", label: E.light },
              ]}
              onChange={(v) => setEditorTheme(v as EditorTheme)}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                setEditorTheme((t) => (t === "nexus-dark" ? "nexus-light" : "nexus-dark"))
              }
              title={E.theme}
              className="grid h-8 w-8 place-items-center rounded-btn border border-border text-text-faint transition-colors hover:text-text"
            >
              <Sun size={14} />
            </button>
            <button
              type="button"
              onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}
              title={E.theme}
              className="grid h-8 w-8 place-items-center rounded-btn border border-border text-text-faint transition-colors hover:text-text"
            >
              <Maximize2 size={14} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <CodeEditor
            value={text}
            onChange={handleChange}
            language="json"
            schemaKind={generated.core}
            themeId={editorTheme}
          />
        </div>

        {/* Status bar */}
        <div className="flex items-center justify-between gap-3 border-t border-border/60 bg-bg-elev/40 px-3 py-1.5 text-[11px] text-text-faint">
          <div className="flex items-center gap-3">
            <span>
              {E.line} 1, {E.col} 1
            </span>
            <span className="text-border">|</span>
            <span>UTF-8</span>
            <span className="text-border">|</span>
            <span className="uppercase">JSON</span>
            <span className="text-border">|</span>
            <span
              className={
                syntaxOk ? "flex items-center gap-1 text-ok" : "flex items-center gap-1 text-bad"
              }
            >
              {syntaxOk ? <Check size={12} /> : <AlertCircle size={12} />}
              {syntaxOk ? E.syntaxOk : E.syntaxBad}
            </span>
          </div>
          <div className="flex items-center gap-3 font-mono">
            <span>
              {E.length}: {sizeKb} KB
            </span>
            <span className="text-border">|</span>
            <span>
              {E.lines}: {lineCount}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
