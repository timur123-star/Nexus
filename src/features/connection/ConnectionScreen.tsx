import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Zap, Globe2, Clock, ChevronRight } from "lucide-react";
import { useServerStore } from "../../store/useServerStore";
import { useConnectionStore } from "../../store/useConnectionStore";
import { Sparkline } from "../../shared/components/Sparkline";
import { ConnectButton } from "../../shared/components/ConnectButton";
import { cn, formatBytes, formatUptime, latencyColor, latencyLabel } from "../../shared/lib/utils";
import { fadeInUp } from "../../shared/lib/motion";
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
    return <EmptyState onBrowse={onBrowse} />;
  }

  const downSeries = samples.map((s) => s.down);
  const upSeries = samples.map((s) => s.up);

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-6 p-8">
      {/* Active server card */}
      <motion.div
        custom={0}
        variants={fadeInUp}
        initial="initial"
        animate="enter"
        className="glass-elev w-full rounded-panel p-7"
      >
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
          <ConnectButton
            state={connected ? "connected" : busy ? "busy" : "idle"}
            onClick={() => toggle(active)}
            labels= connected: "\u041e\u0442\u043a\u043b\u044e\u0447\u0438\u0442\u044c", busy: "\u2026", idle: "\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u044c" 
          />
        </div>

        {/* Live throughput */}
        <div className="grid grid-cols-2 gap-3">
          <ThroughputTile
            label="\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430"
            arrow="\u2193"
            value={formatBytes(traffic.down, true)}
            series={downSeries}
            color="var(--color-teal)"
          />
          <ThroughputTile
            label="\u041e\u0442\u0434\u0430\u0447\u0430"
            arrow="\u2191"
            value={formatBytes(traffic.up, true)}
            series={upSeries}
            color="var(--color-indigo)"
          />
        </div>

        {error && status === "error" && (
          <div className="mt-4 rounded-btn border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">
            {error} \u2014 \u043f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0434\u0440\u0443\u0433\u043e\u0439 \u0441\u0435\u0440\u0432\u0435\u0440.
          </div>
        )}
      </motion.div>

      {/* Mini metrics */}
      <motion.div
        custom={1}
        variants={fadeInUp}
        initial="initial"
        animate="enter"
        className="grid w-full grid-cols-3 gap-3"
      >
        <Metric icon={Globe2} label="\u0410\u0434\u0440\u0435\u0441" value={active.address} mono />
        <Metric icon={Zap} label="\u041f\u043e\u0440\u0442" value={String(active.port)} mono />
        <Metric icon={Clock} label="Uptime" value={connected ? uptime || "0\u0441" : "\u2014"} />
      </motion.div>

      <button
        onClick={onBrowse}
        className="flex items-center gap-1 text-sm text-indigo transition-colors hover:text-indigo-soft"
      >
        \u0411\u044b\u0441\u0442\u0440\u044b\u0439 \u0432\u044b\u0431\u043e\u0440 \u0441\u0435\u0440\u0432\u0435\u0440\u0430 <ChevronRight size={16} />
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
        <h2 className="mt-4 text-lg font-semibold text-text">\u041d\u0435\u0442 \u0441\u0435\u0440\u0432\u0435\u0440\u043e\u0432</h2>
        <p className="mt-1 text-sm text-text-dim">
          \u0414\u043e\u0431\u0430\u0432\u044c\u0442\u0435 \u0441\u0435\u0440\u0432\u0435\u0440 \u043f\u043e \u0441\u0441\u044b\u043b\u043a\u0435, \u0438\u0437 \u043f\u043e\u0434\u043f\u0438\u0441\u043a\u0438 \u0438\u043b\u0438 QR-\u043a\u043e\u0434\u0430, \u0447\u0442\u043e\u0431\u044b \u043d\u0430\u0447\u0430\u0442\u044c.
        </p>
        <button
          onClick={onBrowse}
          className="mt-5 rounded-btn bg-indigo px-4 py-2 text-sm font-medium text-white hover:bg-indigo-soft"
        >
          \u041f\u0435\u0440\u0435\u0439\u0442\u0438 \u043a \u0441\u0435\u0440\u0432\u0435\u0440\u0430\u043c
        </button>
      </div>
    </div>
  );
}
