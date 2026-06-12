import { useEffect, useState } from "react";
import { Trash2, ArrowDown, ArrowUp } from "lucide-react";
import { useConnectionStore } from "../../store/useConnectionStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { getConnections, type ConnectionEntry } from "../../core/ipc";
import { Sparkline } from "../../shared/components/Sparkline";
import { coreLogRing } from "../../shared/hooks/useCoreEvents";
import { formatBytes, cn } from "../../shared/lib/utils";
import { parseDnsLog, type DnsEntry } from "../../core/dns";

export function StatsScreen() {
  const { traffic, samples, status } = useConnectionStore();
  const { clashApiPort, clashSecret } = useSettingsStore((s) => s.proxy);
  const [conns, setConns] = useState<ConnectionEntry[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [dns, setDns] = useState<DnsEntry[]>([]);
  const [logTab, setLogTab] = useState<"core" | "dns">("core");

  useEffect(() => {
    if (status !== "connected") return;
    const id = setInterval(async () => {
      setConns(await getConnections(clashApiPort, clashSecret));
      const ring = [...coreLogRing];
      setLogs(ring.slice(-80).reverse());
      setDns(parseDnsLog(ring).slice(-80).reverse());
    }, 1500);
    return () => clearInterval(id);
  }, [status, clashApiPort, clashSecret]);

  return (
    <div className="flex h-full flex-col gap-4 p-5">
      {/* Live graph */}
      <div className="glass rounded-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text">\u0422\u0440\u0430\u0444\u0438\u043a \u0432 \u0440\u0435\u0430\u043b\u044c\u043d\u043e\u043c \u0432\u0440\u0435\u043c\u0435\u043d\u0438</h3>
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
        <Stat label="\u2193 \u0412\u0441\u0435\u0433\u043e" value={formatBytes(traffic.totalDown)} />
        <Stat label="\u2191 \u0412\u0441\u0435\u0433\u043e" value={formatBytes(traffic.totalUp)} />
        <Stat label="\u0421\u043e\u0435\u0434\u0438\u043d\u0435\u043d\u0438\u0439" value={String(conns.length)} />
        <Stat label="DNS-\u0437\u0430\u043f\u0440\u043e\u0441\u043e\u0432" value={String(dns.length)} />
      </div>

      {/* Connections + log/dns */}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
        <div className="glass flex min-h-0 flex-col rounded-card">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-text">\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u044f</h3>
            <button
              onClick={() => setConns([])}
              className="flex items-center gap-1 text-xs text-text-faint hover:text-bad"
            >
              <Trash2 size={13} /> \u041e\u0447\u0438\u0441\u0442\u0438\u0442\u044c
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2 text-xs">
            {conns.length === 0 && (
              <p className="mt-8 text-center text-text-faint">\u041d\u0435\u0442 \u0430\u043a\u0442\u0438\u0432\u043d\u044b\u0445 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0439</p>
            )}
            {conns.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-surface/50">
                <span className="truncate font-mono text-text-dim" title={c.host}>
                  {c.host}
                </span>
                <span className="ml-2 shrink-0 font-mono text-text-faint">
                  {c.network} \u00b7 {formatBytes(c.download)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass flex min-h-0 flex-col rounded-card">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
            <div className="flex gap-1 rounded-btn bg-bg/40 p-0.5">
              <LogTabBtn active={logTab === "core"} onClick={() => setLogTab("core")}>
                \u041b\u043e\u0433 \u044f\u0434\u0440\u0430
              </LogTabBtn>
              <LogTabBtn active={logTab === "dns"} onClick={() => setLogTab("dns")}>
                DNS
              </LogTabBtn>
            </div>
          </div>
          {logTab === "core" ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed text-text-dim">
              {logs.length === 0 && <p className="mt-8 text-center text-text-faint">\u041b\u043e\u0433 \u043f\u0443\u0441\u0442</p>}
              {logs.map((l, i) => (
                <div key={i} className="truncate px-2 py-0.5" title={l}>
                  {l}
                </div>
              ))}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-2 text-[11px]">
              {dns.length === 0 && (
                <p className="mt-8 text-center text-text-faint">\u041d\u0435\u0442 DNS-\u0437\u0430\u043f\u0440\u043e\u0441\u043e\u0432</p>
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
