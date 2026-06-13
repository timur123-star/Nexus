import { useEffect, useState } from "react";
import { Trash2, ArrowDown, ArrowUp, FolderOpen } from "lucide-react";
import { useConnectionStore } from "../../store/useConnectionStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { getConnections, openLogsDir, type ConnectionEntry } from "../../core/ipc";
import { Sparkline } from "../../shared/components/Sparkline";
import { coreLogRing } from "../../shared/hooks/useCoreEvents";
import { formatBytes, cn } from "../../shared/lib/utils";
import { useT } from "../../core/i18n/useT";
import { parseDnsLog, type DnsEntry } from "../../core/dns";

export function StatsScreen() {
  const { traffic, samples, status } = useConnectionStore();
  const { clashApiPort, clashSecret } = useSettingsStore((s) => s.proxy);
  const t = useT();
  const [conns, setConns] = useState<ConnectionEntry[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [dns, setDns] = useState<DnsEntry[]>([]);
  const [logTab, setLogTab] = useState<"core" | "dns">("core");

  // Live connections come from the Clash API, which only answers while the core
  // is actually running.
  useEffect(() => {
    if (status !== "connected") {
      setConns([]);
      return;
    }
    const id = setInterval(async () => {
      setConns(await getConnections(clashApiPort, clashSecret));
    }, 1500);
    return () => clearInterval(id);
  }, [status, clashApiPort, clashSecret]);

  // Core log + DNS are read from the in-memory ring buffer and must stay live
  // in EVERY state — a connection that fails to start is exactly when the user
  // needs to read the log.
  useEffect(() => {
    const tick = () => {
      const ring = [...coreLogRing];
      setLogs(ring.slice(-200).reverse());
      setDns(parseDnsLog(ring).slice(-100).reverse());
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const clearLogs = () => {
    coreLogRing.length = 0;
    setLogs([]);
    setDns([]);
  };

  // Heaviest connections first so the user immediately sees what is using the
  // tunnel the most.
  const sortedConns = [...conns].sort(
    (a, b) => b.download + b.upload - (a.download + a.upload),
  );

  return (
    <div className="flex h-full flex-col gap-4 p-5">
      {/* Live graph */}
      <div className="glass rounded-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text">{t("stats.liveTraffic")}</h3>
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
        <Stat label={t("stats.totalDown")} value={formatBytes(traffic.totalDown)} />
        <Stat label={t("stats.totalUp")} value={formatBytes(traffic.totalUp)} />
        <Stat label={t("stats.connections")} value={String(conns.length)} />
        <Stat label={t("stats.dnsQueries")} value={String(dns.length)} />
      </div>

      {/* Connections + log/dns */}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
        <div className="glass flex min-h-0 flex-col rounded-card">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-text">{t("stats.connectionsTitle")}</h3>
            <button
              onClick={() => setConns([])}
              className="flex items-center gap-1 text-xs text-text-faint hover:text-bad"
            >
              <Trash2 size={13} /> {t("stats.clear")}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2 text-xs">
            {sortedConns.length === 0 && (
              <p className="mt-8 text-center text-text-faint">{t("stats.noConnections")}</p>
            )}
            {sortedConns.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-surface/50"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-mono text-text-dim" title={c.host}>
                    {c.host}
                  </span>
                  <span className="truncate text-[10px] uppercase tracking-wide text-text-faint">
                    {c.network} · {c.outbound}
                  </span>
                </div>
                <span className="ml-2 flex shrink-0 items-center gap-2 font-mono">
                  <span className="flex items-center gap-0.5 text-teal">
                    <ArrowDown size={11} />
                    {formatBytes(c.download)}
                  </span>
                  <span className="flex items-center gap-0.5 text-indigo">
                    <ArrowUp size={11} />
                    {formatBytes(c.upload)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass flex min-h-0 flex-col rounded-card">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
            <div className="flex gap-1 rounded-btn bg-bg/40 p-0.5">
              <LogTabBtn active={logTab === "core"} onClick={() => setLogTab("core")}>
                {t("stats.coreLog")}
              </LogTabBtn>
              <LogTabBtn active={logTab === "dns"} onClick={() => setLogTab("dns")}>
                DNS
              </LogTabBtn>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void openLogsDir()}
                title={t("settings.openLogs")}
                className="flex items-center gap-1 text-xs text-text-faint hover:text-text"
              >
                <FolderOpen size={13} />
              </button>
              <button
                onClick={clearLogs}
                title={t("stats.clear")}
                className="flex items-center gap-1 text-xs text-text-faint hover:text-bad"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
          {logTab === "core" ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed text-text-dim">
              {logs.length === 0 && <p className="mt-8 text-center text-text-faint">{t("stats.logEmpty")}</p>}
              {logs.map((l, i) => (
                <div key={i} className="whitespace-pre-wrap break-all px-2 py-0.5" title={l}>
                  {l}
                </div>
              ))}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-2 text-[11px]">
              {dns.length === 0 && (
                <p className="mt-8 text-center text-text-faint">{t("stats.noDns")}</p>
              )}
              {dns.map((d, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded px-2 py-1 hover:bg-surface/50"
                >
                  <span className="truncate font-mono text-text-dim" title={d.raw}>
                    {d.domain}
                  </span>
                  {d.result && (
                    <span className="ml-2 shrink-0 font-mono text-text-faint">{d.result}</span>
                  )}
                </div>
              ))}
            </div>
          )}
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

function LogTabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
        active ? "bg-indigo text-white" : "text-text-dim hover:text-text",
      )}
    >
      {children}
    </button>
  );
}
