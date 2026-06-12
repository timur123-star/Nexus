import { useEffect, useState } from "react";
import { Power, Zap, Globe2, Clock, ChevronRight } from "lucide-react";
import { useServerStore } from "../../store/useServerStore";
import { useConnectionStore } from "../../store/useConnectionStore";
import { Sparkline } from "../../shared/components/Sparkline";
import { cn, formatBytes, formatUptime, latencyColor, latencyLabel } from "../../shared/lib/utils";
import { flagFor } from "../../shared/lib/flags";
import { PROTOCOL_LABEL } from "../servers/protocolMeta";

export function ConnectionScreen({ onBrowse }: { onBrowse: () => void }) {
  const servers = useServerStore((s) => s.servers);
  const pingOne = useServerStore((s) => s.pingOne);
  const { status, activeServerId, connectedAt, traffic, samples, toggle, error } = useConnectionStore();

  const active =
    servers.find((s) => s.id === activeServerId) ??
    [...servers].sort((a, b) => (a.latencyMs ?? 9999) - (b.latencyMs ?? 9999))[0];

  const connected = status === "connected";
  const busy = status === "connecting" || status === "reconnecting";

  const [uptime, setUptime] = useState("");
  useEffect(() => {
    if (!connected || !connectedAt) return setUptime("");
    const id = setInterval(() => setUptime(formatUptime(Date.now() - connectedAt)), 1000);
    return () => clearInterval(id);
  }, [connected, connectedAt]);

  // Refresh ping of the active server every 5s.
  useEffect(() => {
    if (!active) return;
    void pingOne(active.id);
    const id = setInterval(() => pingOne(active.id), 5000);
    return () => clearInterval(id);
  }, [active?.id]);

  if (!active) {
    return (
      <EmptyState onBrowse={onBrowse} />
    );
  }

  const downSeries = samples.map((s) => s.down);
  const upSeries = samples.map((s) => s.up);

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-6 p-8">
      {/* Active server card */}
      <div className="glass-elev w-full rounded-panel p-7">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="text-4xl leading-none">{flagFor(active.name)}</span>
            <div>
              <h2 className="text-lg font-semibold text-text">{active.name}</h2>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-text-dim">
                <span className="rounded bg-indigo/15 px-1.5 py-0.5 font-medium text-indigo">
                  {PROTOCOL_LABEL[active.protocol]}
                </span>
                <span className="font-mono uppercase">{active.transport.type}</span>
                {active.tls.security !== "none" && (
                  <span className="font-mono uppercase text-teal">{active.tls.security}</span>
                )}
              </div>
            </div>
          </div>
          <div className={cn("text-right font-mono text-sm font-semibold", latencyColor(active.latencyMs))}>
            {latencyLabel(active.latencyMs)}
          </div>
        </div>

        {/* Connect button with pulse ring */}
        <div className="my-7 flex justify-center">
          <div className="relative">
            {connected && (
              <span className="animate-pulse-ring absolute inset-0 rounded-full bg-ok/40" />
            )}
            <button
              onClick={() => toggle(active)}
              disabled={busy}
              className={cn(
                "relative grid h-28 w-28 place-items-center rounded-full text-white shadow-lg transition-all duration-300 disabled:opacity-70",
                connected
                  ? "bg-gradient-to-br from-ok to-teal shadow-teal/30"
                  : "bg-gradient-to-br from-indigo to-indigo-soft shadow-indigo/30 hover:scale-105",
              )}
            >
              <div className="flex flex-col items-center gap-1">
                <Power size={30} className={busy ? "animate-spin-slow" : ""} />
                <span className="text-xs font-medium">
                  {connected ? "Отключить" : busy ? "…" : "Подключить"}
                </span>
              </div>
            </button>
          </div>
        </div>

        {/* Live throughput */}
        <div className="grid grid-cols-2 gap-3">
          <ThroughputTile
            label="Загрузка"
            arrow="↓"
            value={formatBytes(traffic.down, true)}
            series={downSeries}
            color="var(--color-teal)"
          />
          <ThroughputTile
            label="Отдача"
            arrow="↑"
            value={formatBytes(traffic.up, true)}
            series={upSeries}
            color="var(--color-indigo)"
          />
        </div>

        {error && status === "error" && (
          <div className="mt-4 rounded-btn border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">
            {error} — попробуйте другой сервер.
          </div>
        )}
      </div>

      {/* Mini metrics */}
      <div className="grid w-full grid-cols-3 gap-3">
        <Metric icon={Globe2} label="Адрес" value={active.address} mono />
        <Metric icon={Zap} label="Порт" value={String(active.port)} mono />
        <Metric icon={Clock} label="Uptime" value={connected ? uptime || "0с" : "—"} />
      </div>

      <button
        onClick={onBrowse}
        className="flex items-center gap-1 text-sm text-indigo transition-colors hover:text-indigo-soft"
      >
        Быстрый выбор сервера <ChevronRight size={16} />
      </button>
    </div>
  );
}

function ThroughputTile({
  label,
  arrow,
  value,
  series,
  color,
}: {
  label: string;
  arrow: string;
  value: string;
  series: number[];
  color: string;
}) {
  return (
    <div className="glass rounded-card p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-dim">
          {arrow} {label}
        </span>
        <span className="font-mono text-sm font-semibold text-text">{value}</span>
      </div>
      <div className="mt-2">
        <Sparkline data={series} width={240} height={28} color={color} />
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="glass rounded-card px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-text-faint">
        <Icon size={13} /> {label}
      </div>
      <div className={cn("mt-0.5 truncate text-sm text-text", mono && "font-mono")} title={value}>
        {value}
      </div>
    </div>
  );
}

function EmptyState({ onBrowse }: { onBrowse: () => void }) {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-sm">
        <Globe2 size={48} className="mx-auto text-text-faint" />
        <h2 className="mt-4 text-lg font-semibold text-text">Нет серверов</h2>
        <p className="mt-1 text-sm text-text-dim">
          Добавьте сервер по ссылке, из подписки или QR-кода, чтобы начать.
        </p>
        <button
          onClick={onBrowse}
          className="mt-5 rounded-btn bg-indigo px-4 py-2 text-sm font-medium text-white hover:bg-indigo-soft"
        >
          Перейти к серверам
        </button>
      </div>
    </div>
  );
}
