import { useEffect, useState } from "react";
import { Trash2, ArrowDown, ArrowUp } from "lucide-react";
import { useConnectionStore } from "../../store/useConnectionStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { getConnections, type ConnectionEntry } from "../../core/ipc";
import { Sparkline } from "../../shared/components/Sparkline";
import { coreLogRing } from "../../shared/hooks/useCoreEvents";
import { formatBytes } from "../../shared/lib/utils";

export function StatsScreen() {
  const { traffic, samples, status } = useConnectionStore();
  const { clashApiPort, clashSecret } = useSettingsStore((s) => s.proxy);
  const [conns, setConns] = useState<ConnectionEntry[]>([]);
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    if (status !== "connected") return;
    const id = setInterval(async () => {
      setConns(await getConnections(clashApiPort, clashSecret));
      setLogs([...coreLogRing].slice(-80).reverse());
    }, 1500);
    return () => clearInterval(id);
  }, [status, clashApiPort, clashSecret]);

  return (
    <div className="flex h-full flex-col gap-4 p-5">
      {/* Live graph */}
      <div className="glass rounded-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text">Трафик в реальном времени</h3>
          <div className="flex gap-4 text-xs">
            <span className="flex items-center gap-1 text-teal">
              <ArrowDown size={13} /> {formatBytes(traffic.down, true)}
            </span>
            <span className="flex items-center gap-1 text-indigo">
              <ArrowUp size={13} /> {formatBytes(traffic.up, true)}
            </span>
          </div>
        </div>
        <div className="relative">
          <Sparkline data={samples.map((s) => s.down)} width={900} height={90} color="var(--color-teal)" />
          <div className="absolute inset-0">
            <Sparkline data={samples.map((s) => s.up)} width={900} height={90} color="var(--color-indigo)" fill={false} />
          </div>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-4 gap-3">
        <Stat label="↓ Всего" value={formatBytes(traffic.totalDown)} />
        <Stat label="↑ Всего" value={formatBytes(traffic.totalUp)} />
        <Stat label="Соединений" value={String(conns.length)} />
        <Stat label="Статус" value={status === "connected" ? "Активно" : "Неактивно"} />
      </div>

      {/* Connections + log */}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
        <div className="glass flex min-h-0 flex-col rounded-card">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-text">Подключения</h3>
            <button
              onClick={() => setConns([])}
              className="flex items-center gap-1 text-xs text-text-faint hover:text-bad"
            >
              <Trash2 size={13} /> Очистить
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2 text-xs">
            {conns.length === 0 && (
              <p className="mt-8 text-center text-text-faint">Нет активных подключений</p>
            )}
            {conns.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-surface/50">
                <span className="truncate font-mono text-text-dim" title={c.host}>
                  {c.host}
                </span>
                <span className="ml-2 shrink-0 font-mono text-text-faint">
                  {c.network} · {formatBytes(c.download)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass flex min-h-0 flex-col rounded-card">
          <div className="border-b border-border/60 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-text">Лог ядра</h3>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed text-text-dim">
            {logs.length === 0 && <p className="mt-8 text-center text-text-faint">Лог пуст</p>}
            {logs.map((l, i) => (
              <div key={i} className="truncate px-2 py-0.5" title={l}>
                {l}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-card px-4 py-3">
      <div className="text-[11px] text-text-faint">{label}</div>
      <div className="mt-1 font-mono text-base font-semibold text-text">{value}</div>
    </div>
  );
}
