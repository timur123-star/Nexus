import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, AlertCircle, Download, RefreshCw } from "lucide-react";
import { useServerStore } from "../../store/useServerStore";
import { useConnectionStore } from "../../store/useConnectionStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { getCore, ALL_CORES } from "../../core/proxy";
import { validateConfig } from "../../core/ipc";
import { CodeEditor } from "../../shared/components/CodeEditor";
import { useT } from "../../core/i18n/useT";
import type { CoreKind } from "../../core/types";

export function EditorScreen() {
  const t = useT();
  const servers = useServerStore((s) => s.servers);
  const activeId = useConnectionStore((s) => s.activeServerId);
  const proxy = useSettingsStore((s) => s.proxy);

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

  const [text, setText] = useState(generated.text);
  const [dirty, setDirty] = useState(false);
  const [check, setCheck] = useState<{ ok: boolean; error?: string } | null>(null);

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

  function handleExport() {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nexusshield-${active?.name ?? "config"}.json`.replace(/[^\w.-]+/g, "_");
    a.click();
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
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleRegenerate}
            className="glass flex items-center gap-1.5 rounded-btn px-3 py-2 text-sm text-text-dim hover:text-text"
          >
            <RefreshCw size={14} /> {t("editor.regenerate")}
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

      <div className="min-h-0 flex-1 overflow-hidden rounded-card border border-border">
        <CodeEditor value={text} onChange={handleChange} language="json" schemaKind={generated.core} />
      </div>
    </div>
  );
}
