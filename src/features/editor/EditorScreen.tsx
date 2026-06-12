import { useMemo, useState } from "react";
import { CheckCircle2, AlertCircle, Download, RefreshCw } from "lucide-react";
import { useServerStore } from "../../store/useServerStore";
import { useConnectionStore } from "../../store/useConnectionStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { generateSingboxConfig } from "../../core/singbox/configGen";
import { validateConfig } from "../../core/ipc";

export function EditorScreen() {
  const servers = useServerStore((s) => s.servers);
  const activeId = useConnectionStore((s) => s.activeServerId);
  const proxy = useSettingsStore((s) => s.proxy);

  const active = servers.find((s) => s.id === activeId) ?? servers[0];

  const generated = useMemo(() => {
    if (!active) return "{}";
    const cfg = generateSingboxConfig(active, {
      mixedPort: proxy.mixedPort,
      clashApiPort: proxy.clashApiPort,
      clashSecret: proxy.clashSecret,
      routingMode: proxy.routingMode,
      tun: proxy.tun,
      allowLan: proxy.allowLan,
      fakeIp: proxy.fakeIp,
      dns: proxy.dns,
    });
    return JSON.stringify(cfg, null, 2);
  }, [active, proxy]);

  const [text, setText] = useState(generated);
  const [check, setCheck] = useState<{ ok: boolean; error?: string } | null>(null);

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
          <h2 className="text-base font-semibold text-text">Редактор конфигурации</h2>
          <p className="text-xs text-text-faint">
            sing-box config для «{active?.name ?? "—"}»
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setText(generated)}
            className="glass flex items-center gap-1.5 rounded-btn px-3 py-2 text-sm text-text-dim hover:text-text"
          >
            <RefreshCw size={14} /> Сгенерировать заново
          </button>
          <button
            onClick={handleValidate}
            className="glass flex items-center gap-1.5 rounded-btn px-3 py-2 text-sm text-text-dim hover:text-text"
          >
            <CheckCircle2 size={14} /> Проверить
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 rounded-btn bg-indigo px-3 py-2 text-sm font-medium text-white hover:bg-indigo-soft"
          >
            <Download size={14} /> Экспорт
          </button>
        </div>
      </div>

      {check && (
        <div
          className={`mb-2 flex items-center gap-2 rounded-btn px-3 py-2 text-xs ${
            check.ok ? "bg-ok/10 text-ok" : "bg-bad/10 text-bad"
          }`}
        >
          {check.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
          {check.ok ? "Конфигурация валидна" : check.error}
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        className="min-h-0 flex-1 resize-none rounded-card border border-border bg-bg/60 p-4 font-mono text-xs leading-relaxed text-text outline-none focus:border-indigo"
      />
    </div>
  );
}
