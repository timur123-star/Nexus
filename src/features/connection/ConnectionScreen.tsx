import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Zap, Globe2, Clock, ChevronRight, Rocket, Download, Upload, Cpu } from "lucide-react";
import type { ConnectionStatus } from "../../core/types";
import { useServerStore } from "../../store/useServerStore";
import { useConnectionStore } from "../../store/useConnectionStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { toast } from "../../store/useToastStore";
import { Sparkline } from "../../shared/components/Sparkline";
import { ConnectButton } from "../../shared/components/ConnectButton";
import { cn, formatBytes, formatUptime, latencyColor, latencyLabel } from "../../shared/lib/utils";
import { fadeInUp } from "../../shared/lib/motion";
import { flagFor } from "../../shared/lib/flags";
import { PROTOCOL_LABEL } from "../servers/protocolMeta";
import { useT } from "../../core/i18n/useT";
import type { MessageKey } from "../../core/i18n";

const STATUS_DOT: Record<ConnectionStatus, string> = {
  connected: "bg-ok",
  connecting: "bg-warn",
  reconnecting: "bg-warn",
  error: "bg-bad",
  disconnected: "bg-text-faint",
};

const STATUS_LABEL_KEY: Record<ConnectionStatus, MessageKey> = {
  connected: "conn.connected",
  connecting: "conn.connecting",
  reconnecting: "conn.reconnecting",
  error: "conn.error",
  disconnected: "conn.disconnected",
};

/**
 * Dashboard-only labels. Kept as a local en/ru map (other languages fall back
 * to English) so the global i18n catalogue — and its strict key-parity test —
 * stays untouched while we iterate on this screen.
 */
interface DashStrings {
  downloaded: string;
  uploaded: string;
  core: string;
  peak: string;
}
const DASH_STRINGS: Record<string, DashStrings> = {
  en: { downloaded: "Downloaded", uploaded: "Uploaded", core: "Core", peak: "peak" },
  ru: { downloaded: "\u0421\u043a\u0430\u0447\u0430\u043d\u043e", uploaded: "\u041e\u0442\u0434\u0430\u043d\u043e", core: "\u042f\u0434\u0440\u043e", peak: "\u043f\u0438\u043a" },
};

const dotPulseAnimate = { opacity: [1, 0.35, 1], scale: [1, 1.5, 1] };
const dotStaticAnimate = { opacity: 1, scale: 1 };
const valueInitial = { opacity: 0.35, y: -2 };
const valueAnimate = { opacity: 1, y: 0 };
const valueTransition = { duration: 0.25, ease: "easeOut" };
const floatAnimate = { y: [0, -8, 0] };
const floatTransition = { duration: 4, repeat: Infinity, ease: "easeInOut" };

function StatusDot({ status }: { status: ConnectionStatus }) {
  const t = useT();
  const dot = STATUS_DOT[status] ?? STATUS_DOT.disconnected;
  const label = t(STATUS_LABEL_KEY[status] ?? "conn.disconnected");
  const animated =
    status === "connected" || status === "connecting" || status === "reconnecting";
  const fast = status === "connecting" || status === "reconnecting";
  const transition = animated
    ? { duration: fast ? 0.9 : 1.8, repeat: Infinity, ease: "easeInOut" }
    : { duration: 0.2 };
  return (
    <span className="flex items-center gap-1.5 text-xs text-text-dim">
      <motion.span
        aria-hidden
        className={cn("h-2 w-2 rounded-full", dot)}
        animate={animated ? dotPulseAnimate : dotStaticAnimate}
        transition={transition}
      />
      {label}
    </span>
  );
}

export function ConnectionScreen({ onBrowse }: { onBrowse: () => void }) {
  const t = useT();
  const lang = useSettingsStore((s) => s.app.language);
  const proxyCore = useSettingsStore((s) => s.proxy.coreKind);
  const L = DASH_STRINGS[lang] ?? DASH_STRINGS.en;
  const servers = useServerStore((s) => s.servers);
  const pingOne = useServerStore((s) => s.pingOne);
  const pingAllAndBest = useServerStore((s) => s.pingAllAndBest);
  const { status, activeServerId, activeCore, connectedAt, traffic, samples, toggle, connect, error } =
    useConnectionStore();

  const active =
    servers.find((s) => s.id === activeServerId) ??
    [...servers].sort((a, b) => (a.latencyMs ?? 9999) - (b.latencyMs ?? 9999))[0];

  const connected = status === "connected";
  const busy = status === "connecting" || status === "reconnecting";

  const [autoBusy, setAutoBusy] = useState(false);
  const handleAutoBest = async () => {
    if (autoBusy) return;
    setAutoBusy(true);
    try {
      const best = await pingAllAndBest();
      if (!best) {
        toast.warning(t("servers.autoNone"));
        return;
      }
      toast.success(t("servers.autoConnecting", { name: best.name }));
      await connect(best);
    } finally {
      setAutoBusy(false);
    }
  };

  const unitH = t("common.unit.h");
  const unitM = t("common.unit.m");
  const unitS = t("common.unit.s");

  const [uptime, setUptime] = useState("");
  useEffect(() => {
    if (!connected || !connectedAt) return setUptime("");
    const units = { h: unitH, m: unitM, s: unitS };
    const tick = () => setUptime(formatUptime(Date.now() - connectedAt, units));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [connected, connectedAt, unitH, unitM, unitS]);

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
  const peakDown = downSeries.length ? Math.max(...downSeries) : 0;
  const peakUp = upSeries.length ? Math.max(...upSeries) : 0;
  const connectState = connected ? "connected" : busy ? "busy" : "idle";
  const connectLabels = {
    connected: t("common.disconnect"),
    busy: "\u2026",
    idle: t("common.connect"),
  };
  const shownCore = (connected || busy) && activeCore ? activeCore : proxyCore;
  const coreLabel = shownCore === "xray" ? "Xray" : "sing-box";
  const dash = "\u2014";

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center gap-6 p-8">
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
          <div className="flex flex-col items-end gap-1.5">
            <div className={cn("font-mono text-sm font-semibold", latencyColor(active.latencyMs))}>
              {latencyLabel(active.latencyMs)}
            </div>
            <StatusDot status={status} />
          </div>
        </div>

        {/* Connect button with pulse ring */}
        <div className="mb-3 mt-7 flex justify-center">
          <ConnectButton
            state={connectState}
            onClick={() => toggle(active)}
            labels={connectLabels}
          />
        </div>

        {/* Quick auto-best action */}
        <div className="mb-5 flex justify-center">
          <button
            type="button"
            onClick={handleAutoBest}
            disabled={autoBusy || busy}
            title={t("servers.autoBest")}
            className="flex items-center gap-1.5 rounded-btn border border-border px-3 py-1.5 text-xs text-text-dim transition-colors hover:border-indigo/40 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Rocket size={13} className={cn(autoBusy && "animate-pulse")} />
            {t("servers.autoBest")}
          </button>
        </div>

        {/* Live throughput */}
        <div className="grid grid-cols-2 gap-3">
          <ThroughputTile
            label={t("conn.download")}
            arrow="↓"
            value={formatBytes(traffic.down, true)}
            caption={connected && peakDown > 0 ? `${L.peak} ${formatBytes(peakDown, true)}` : undefined}
            series={downSeries}
            color="var(--color-teal)"
          />
          <ThroughputTile
            label={t("conn.upload")}
            arrow="↑"
            value={formatBytes(traffic.up, true)}
            caption={connected && peakUp > 0 ? `${L.peak} ${formatBytes(peakUp, true)}` : undefined}
            series={upSeries}
            color="var(--color-indigo)"
          />
        </div>

        {/* Session summary */}
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Metric
            icon={Clock}
            label={t("conn.uptime")}
            value={connected ? uptime || `0${unitS}` : dash}
          />
          <Metric
            icon={Download}
            label={L.downloaded}
            value={connected ? formatBytes(traffic.totalDown) : dash}
            mono
          />
          <Metric
            icon={Upload}
            label={L.uploaded}
            value={connected ? formatBytes(traffic.totalUp) : dash}
            mono
          />
        </div>

        {error && status === "error" && (
          <div className="mt-4 rounded-btn border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">
            {error} {t("conn.errorSuffix")}
          </div>
        )}
      </motion.div>

      {/* Connection details */}
      <motion.div
        custom={1}
        variants={fadeInUp}
        initial="initial"
        animate="enter"
        className="grid w-full grid-cols-3 gap-3"
      >
        <Metric icon={Globe2} label={t("conn.address")} value={active.address} mono />
        <Metric icon={Zap} label={t("conn.port")} value={String(active.port)} mono />
        <Metric icon={Cpu} label={L.core} value={coreLabel} mono />
      </motion.div>

      <button
        onClick={onBrowse}
        className="flex items-center gap-1 text-sm text-indigo transition-colors hover:text-indigo-soft"
      >
        {t("conn.quickSelect")} <ChevronRight size={16} />
      </button>
    </div>
  );
}

function ThroughputTile({
  label,
  arrow,
  value,
  caption,
  series,
  color,
}: {
  label: string;
  arrow: string;
  value: string;
  caption?: string;
  series: number[];
  color: string;
}) {
  return (
    <div className="glass ns-lift rounded-card p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-dim">
          {arrow} {label}
        </span>
        <motion.span
          key={value}
          initial={valueInitial}
          animate={valueAnimate}
          transition={valueTransition}
          className="font-mono text-sm font-semibold text-text"
        >
          {value}
        </motion.span>
      </div>
      <div className="mt-0.5 h-3.5 text-right text-[10px] text-text-faint">{caption ?? ""}</div>
      <div className="mt-1">
        <Sparkline data={series} width={240} height={28} color={color} responsive />
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
    <div className="glass ns-lift rounded-card px-3 py-2.5">
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
  const t = useT();
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-sm">
        <motion.div animate={floatAnimate} transition={floatTransition} className="mx-auto w-fit">
          <Globe2 size={48} className="text-text-faint" />
        </motion.div>
        <h2 className="mt-4 text-lg font-semibold text-text">{t("conn.noServers")}</h2>
        <p className="mt-1 text-sm text-text-dim">{t("conn.noServersHint")}</p>
        <button
          onClick={onBrowse}
          className="mt-5 rounded-btn bg-indigo px-4 py-2 text-sm font-medium text-white hover:bg-indigo-soft"
        >
          {t("conn.goToServers")}
        </button>
      </div>
    </div>
  );
}
