import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Trash2, ArrowDown, ArrowUp, FolderOpen, Clock, Cpu, Info } from "lucide-react";
import { useConnectionStore } from "../../store/useConnectionStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { getConnections, openLogsDir, type ConnectionEntry } from "../../core/ipc";
import { TrafficGraph } from "./TrafficGraph";
import { SpeedTestPanel } from "./SpeedTestPanel";
import { coreLogRing } from "../../shared/hooks/useCoreEvents";
import { formatBytes, formatUptime, cn } from "../../shared/lib/utils";
import { useT } from "../../core/i18n/useT";
import { parseDnsLog, type DnsEntry } from "../../core/dns";
import type { Lang } from "../../core/i18n";

// Inline localisation for the new stats labels — keeps messages.ts (and its
// i18n parity test) untouched.
const STATS_STRINGS: Record<
  Lang,
  { session: string; uptime: string; peak: string; avg: string; idle: string; xrayNote: string }
> = {
  en: {
    session: "Current session",
    uptime: "Uptime",
    peak: "Peak",
    avg: "Avg",
    idle: "Not connected",
    xrayNote:
      "Live traffic and connection stats need the Clash API, which the Xray core does not expose — these counters stay at zero. The logs below still work.",
  },
  ru: {
    session: "\u0422\u0435\u043a\u0443\u0449\u0430\u044f \u0441\u0435\u0441\u0441\u0438\u044f",
    uptime: "\u0410\u043f\u0442\u0430\u0439\u043c",
    peak: "\u041f\u0438\u043a",
    avg: "\u0421\u0440.",
    idle: "\u041d\u0435\u0442 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u044f",
    xrayNote:
      "Статистика трафика и соединений работает через Clash API, которого нет у ядра Xray — счётчики остаются на нуле. Логи ниже работают.",
  },
  fa: {
    session: "\u0646\u0634\u0633\u062a \u0641\u0639\u0644\u06cc",
    uptime: "\u0632\u0645\u0627\u0646 \u0641\u0639\u0627\u0644\u06cc",
    peak: "\u0627\u0648\u062c",
    avg: "\u0645\u06cc\u0627\u0646\u06af\u06cc\u0646",
    idle: "\u0645\u062a\u0635\u0644 \u0646\u06cc\u0633\u062a",
    xrayNote:
      "آمار ترافیک و اتصال‌ها به Clash API نیاز دارد که هسته Xray آن را ارائه نمی‌دهد؛ شمارنده‌ها صفر می‌مانند. گزارش‌های زیر کار می‌کنند.",
  },
  zh: {
    session: "\u5f53\u524d\u4f1a\u8bdd",
    uptime: "\u8fd0\u884c\u65f6\u95f4",
    peak: "\u5cf0\u503c",
    avg: "\u5e73\u5747",
    idle: "\u672a\u8fde\u63a5",
    xrayNote:
      "流量和连接统计需要 Clash API，而 Xray 内核不提供该接口——此处计数器保持为零。下方日志仍可用。",
  },
};

const dotAnimate = { opacity: [1, 0.35, 1], scale: [1, 1.45, 1] };
const dotTransition = { duration: 1.6, repeat: Infinity, ease: "easeInOut" };

export function StatsScreen() {
  const { traffic, samples, status, connectedAt, activeServer, activeCore } = useConnectionStore();
  const { clashApiPort, clashSecret } = useSettingsStore((s) => s.proxy);
  const t = useT();
  const lang = useSettingsStore((s) => s.app.language);
  const S = STATS_STRINGS[lang] ?? STATS_STRINGS.en;
  const [conns, setConns] = useState<ConnectionEntry[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [dns, setDns] = useState<DnsEntry[]>([]);
  const [logTab, setLogTab] = useState<"core" | "dns">("core");
  const [nowTs, setNowTs] = useState(() => Date.now());

  const connected = status === "connected" || status === "reconnecting";
  const xrayActive = connected && activeCore === "xray";

  // Tick once a second so the uptime read-out stays live without coupling to
  // the (faster) traffic poller.
  useEffect(() => {
    if (!connected || !connectedAt) return;
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [connected, connectedAt]);

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
  // Scale usage bars against the single heaviest connection.
  const maxConnTotal = sortedConns.reduce(
    (m, c) => Math.max(m, c.download + c.upload),
    0,
  );

  // Rolling-window peaks / averages for the live graph footer.
  const downSeries = samples.map((s) => s.down);
  const upSeries = samples.map((s) => s.up);
  const peakDown = downSeries.length ? Math.max(...downSeries) : 0;
  const peakUp = upSeries.length ? Math.max(...upSeries) : 0;
  const avgDown = downSeries.length
    ? downSeries.reduce((a, b) => a + b, 0) / downSeries.length
    : 0;
  const avgUp = upSeries.length ? upSeries.reduce((a, b) => a + b, 0) / upSeries.length : 0;

  const uptimeUnits = { h: t("common.unit.h"), m: t("common.unit.m"), s: t("common.unit.s") };
  const uptimeText =
    connected && connectedAt ? formatUptime(nowTs - connectedAt, uptimeUnits) : "\u2014";
  const coreLabel = activeCore ? (activeCore === "xray" ? "Xray" : "sing-box") : null;

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4 p-5">
      {/* Session panel */}
      <div className="glass flex items-center justify-between rounded-card px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {connected ? (
            <motion.span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full bg-ok"
              animate={dotAnimate}
              transition={dotTransition}
            />
          ) : (
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-text-faint/50" />
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-text">
              {connected ? activeServer?.name ?? S.idle : S.idle}
            </div>
            <div className="text-[11px] text-text-faint">{S.session}</div>
          </div>
        </div>
        <div className="flex flex-col items-end">
          <div className="flex items-center gap-1.5 font-mono text-base font-semibold text-text">
            <Clock size={14} className="text-text-faint" />
            {uptimeText}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-faint">
            {S.uptime}
            {coreLabel && (
              <span className="flex items-center gap-1 rounded bg-indigo/15 px-1.5 font-mono text-indigo">
                <Cpu size={10} /> {coreLabel}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Xray has no Clash API — be honest about the empty traffic counters
          instead of silently showing zeros. */}
      {xrayActive && (
        <div className="flex items-start gap-2 rounded-card border border-warn/30 bg-warn/10 px-4 py-2.5 text-xs text-text-dim">
          <Info size={14} className="mt-0.5 shrink-0 text-warn" />
          <span>{S.xrayNote}</span>
        </div>
      )}

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
        <TrafficGraph downSeries={downSeries} upSeries={upSeries} active={connected} />
        <div className="mt-2 flex items-center justify-between text-[11px] text-text-faint">
          <span className="flex items-center gap-1">
            <span className="text-text-dim">{S.peak}</span>
            <span className="text-teal">↓ {formatBytes(peakDown, true)}</span>
            <span className="text-indigo">↑ {formatBytes(peakUp, true)}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-text-dim">{S.avg}</span>
            <span className="text-teal">↓ {formatBytes(avgDown, true)}</span>
            <span className="text-indigo">↑ {formatBytes(avgUp, true)}</span>
          </span>
        </div>
      </div>

      {/* Real download/upload/latency/jitter speed test through the tunnel */}
      <SpeedTestPanel />

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
              <p className="mt-8 text-center text-text-faint">{xrayActive ? S.xrayNote : t("stats.noConnections")}</p>
            )}
            {sortedConns.map((c) => {
              const total = c.download + c.upload;
              const share = maxConnTotal > 0 ? (total / maxConnTotal) * 100 : 0;
              return (
                <div key={c.id} className="rounded px-2 py-1.5 hover:bg-surface/50">
                  <div className="flex items-center justify-between gap-2">
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
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface">
                    <div
                      className="h-full rounded-full bg-indigo/60"
                      style={ { width: `${share}%` } }
                    />
                  </div>
                </div>
              );
            })}
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
