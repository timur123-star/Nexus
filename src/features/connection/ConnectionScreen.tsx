import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Zap, Globe2, ChevronRight, Rocket, Download, Upload, Cpu, ShieldCheck, Lock, Activity } from "lucide-react";
import type { ConnectionStatus } from "../../core/types";
import { useServerStore } from "../../store/useServerStore";
import { useConnectionStore } from "../../store/useConnectionStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { toast } from "../../store/useToastStore";
import { Sparkline } from "../../shared/components/Sparkline";
import { ShieldConnectButton } from "../../shared/components/ShieldConnectButton";
import { cn, formatBytes, formatUptime, latencyColor, latencyLabel } from "../../shared/lib/utils";
import { fadeInUp } from "../../shared/lib/motion";
import { flagFor } from "../../shared/lib/flags";
import { PROTOCOL_LABEL } from "../servers/protocolMeta";
import { useT } from "../../core/i18n/useT";
import type { Lang, MessageKey } from "../../core/i18n";

const STATUS_LABEL_KEY: Record<ConnectionStatus, MessageKey> = {
  connected: "conn.connected",
  connecting: "conn.connecting",
  reconnecting: "conn.reconnecting",
  error: "conn.error",
  disconnected: "conn.disconnected",
};

/**
 * Dashboard-only labels. Kept as a local map (other languages fall back to
 * English) so the global i18n catalogue — and its strict key-parity test —
 * stays untouched while we iterate on this screen.
 */
interface DashStrings {
  downloaded: string;
  uploaded: string;
  core: string;
  peak: string;
  xrayLive: string;
  ipAddress: string;
  protocol: string;
  encryption: string;
  connStatus: string;
  stable: string;
  protectedTitle: string;
  protectedSub: string;
  exposedTitle: string;
  exposedSub: string;
  tapConnect: string;
}
const DASH_STRINGS: Record<Lang, DashStrings> = {
  en: {
    downloaded: "Downloaded", uploaded: "Uploaded", core: "Core", peak: "peak",
    xrayLive: "Live counters need the Clash API — unavailable on the Xray core.",
    ipAddress: "IP Address", protocol: "Protocol", encryption: "Encryption", connStatus: "Status",
    stable: "Stable", protectedTitle: "You are protected", protectedSub: "Your traffic is encrypted and private.",
    exposedTitle: "You are exposed", exposedSub: "Connect to secure your traffic.", tapConnect: "Tap to connect",
  },
  ru: {
    downloaded: "\u0421\u043a\u0430\u0447\u0430\u043d\u043e", uploaded: "\u041e\u0442\u0434\u0430\u043d\u043e", core: "\u042f\u0434\u0440\u043e", peak: "\u043f\u0438\u043a",
    xrayLive: "Живые счётчики работают через Clash API — недоступно на ядре Xray.",
    ipAddress: "IP-адрес", protocol: "Протокол", encryption: "Шифрование", connStatus: "Статус",
    stable: "Стабильно", protectedTitle: "Вы под защитой", protectedSub: "Трафик зашифрован и приватен.",
    exposedTitle: "Вы не защищены", exposedSub: "Подключитесь, чтобы защитить трафик.", tapConnect: "Нажмите, чтобы подключиться",
  },
  fa: {
    downloaded: "دانلود‌شده", uploaded: "آپلود‌شده", core: "هسته", peak: "اوج",
    xrayLive: "شمارنده‌های زنده به Clash API نیاز دارند — روی هسته Xray در دسترس نیست.",
    ipAddress: "آدرس IP", protocol: "پروتکل", encryption: "رمزنگاری", connStatus: "وضعیت",
    stable: "پایدار", protectedTitle: "شما محافظت می‌شوید", protectedSub: "ترافیک شما رمزنگاری و خصوصی است.",
    exposedTitle: "شما در معرض هستید", exposedSub: "برای ایمن‌سازی ترافیک متصل شوید.", tapConnect: "برای اتصال ضربه بزنید",
  },
  zh: {
    downloaded: "已下载", uploaded: "已上传", core: "核心", peak: "峰值",
    xrayLive: "实时计数依赖 Clash API——Xray 内核不可用。",
    ipAddress: "IP 地址", protocol: "协议", encryption: "加密", connStatus: "状态",
    stable: "稳定", protectedTitle: "您已受保护", protectedSub: "您的流量已加密且私密。",
    exposedTitle: "您已暴露", exposedSub: "连接以保护您的流量。", tapConnect: "点击连接",
  },
};

const valueInitial = { opacity: 0.35, y: -2 };
const valueAnimate = { opacity: 1, y: 0 };
const valueTransition = { duration: 0.25, ease: "easeOut" };
const floatAnimate = { y: [0, -8, 0] };
const floatTransition = { duration: 4, repeat: Infinity, ease: "easeInOut" };

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
  const xrayActive = connected && activeCore === "xray";

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
  const shieldState = connected ? "connected" : busy ? "busy" : "idle";
  const shieldLabel = connected ? t("common.disconnect") : busy ? t(STATUS_LABEL_KEY[status]) : t("common.connect");
  const shieldSub = connected ? uptime || `0${unitS}` : busy ? "\u2026" : L.tapConnect;
  const shownCore = (connected || busy) && activeCore ? activeCore : proxyCore;
  const coreLabel = shownCore === "xray" ? "Xray" : "sing-box";
  const dash = "\u2014";
  const encryption = active.tls.security !== "none" ? active.tls.security.toUpperCase() : "AES-256";
  const statusText = connected ? L.stable : t(STATUS_LABEL_KEY[status]);

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col items-center gap-6 px-6 py-8">
      {/* Protection banner */}
      <motion.div
        custom={0}
        variants={fadeInUp}
        initial="initial"
        animate="enter"
        className="glass flex w-full items-center justify-between rounded-panel px-5 py-3.5"
      >
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "grid h-9 w-9 place-items-center rounded-full transition-colors",
              connected ? "bg-ok/15 text-ok" : "bg-text-faint/10 text-text-dim",
            )}
          >
            <ShieldCheck size={18} />
          </span>
          <div className="leading-tight">
            <div className={cn("text-sm font-semibold", connected ? "text-ok" : "text-text")}>
              {connected ? L.protectedTitle : L.exposedTitle}
            </div>
            <div className="text-xs text-text-dim">{connected ? L.protectedSub : L.exposedSub}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-text-faint">{t("conn.uptime")}</div>
          <div className="font-mono text-sm font-semibold text-text">
            {connected ? uptime || `0${unitS}` : dash}
          </div>
        </div>
      </motion.div>

      {/* Hero: server identity + shield */}
      <motion.div
        custom={1}
        variants={fadeInUp}
        initial="initial"
        animate="enter"
        className="flex w-full flex-col items-center gap-6 py-2"
      >
        <div className="glass flex items-center gap-3 rounded-full px-4 py-2">
          <span className="text-2xl leading-none">{flagFor(active.name)}</span>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-text">{active.name}</div>
            <div className="flex items-center gap-2 text-[11px] text-text-dim">
              <span className="rounded bg-indigo/15 px-1.5 font-medium text-indigo">
                {PROTOCOL_LABEL[active.protocol]}
              </span>
              <span className={cn("font-mono font-semibold", latencyColor(active.latencyMs))}>
                {latencyLabel(active.latencyMs)}
              </span>
            </div>
          </div>
        </div>

        <ShieldConnectButton
          state={shieldState}
          onClick={() => toggle(active)}
          label={shieldLabel}
          sublabel={shieldSub}
        />

        {/* Quick auto-best action */}
        <button
          type="button"
          onClick={handleAutoBest}
          disabled={autoBusy || busy}
          title={t("servers.autoBest")}
          className="flex items-center gap-1.5 rounded-btn border border-border bg-bg-elev/40 px-3.5 py-1.5 text-xs text-text-dim backdrop-blur transition-colors hover:border-indigo/40 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Rocket size={13} className={cn(autoBusy && "animate-pulse")} />
          {t("servers.autoBest")}
        </button>
      </motion.div>

      {/* Mockup-style info tiles */}
      <motion.div
        custom={2}
        variants={fadeInUp}
        initial="initial"
        animate="enter"
        className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4"
      >
        <InfoTile icon={Globe2} label={L.ipAddress} value={active.address} mono />
        <InfoTile icon={Zap} label={L.protocol} value={PROTOCOL_LABEL[active.protocol]} />
        <InfoTile icon={Lock} label={L.encryption} value={encryption} mono />
        <InfoTile
          icon={Activity}
          label={L.connStatus}
          value={statusText}
          valueClass={connected ? "text-ok" : busy ? "text-warn" : "text-text-dim"}
        />
      </motion.div>

      {/* Live throughput */}
      <motion.div
        custom={3}
        variants={fadeInUp}
        initial="initial"
        animate="enter"
        className="grid w-full grid-cols-2 gap-3"
      >
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
      </motion.div>

      {/* Session summary */}
      <motion.div
        custom={4}
        variants={fadeInUp}
        initial="initial"
        animate="enter"
        className="grid w-full grid-cols-3 gap-3"
      >
        <InfoTile
          icon={Download}
          label={L.downloaded}
          value={connected ? formatBytes(traffic.totalDown) : dash}
          mono
        />
        <InfoTile
          icon={Upload}
          label={L.uploaded}
          value={connected ? formatBytes(traffic.totalUp) : dash}
          mono
        />
        <InfoTile icon={Cpu} label={L.core} value={coreLabel} mono />
      </motion.div>

      {xrayActive && (
        <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-text-faint">
          <Cpu size={11} /> {L.xrayLive}
        </p>
      )}

      {error && status === "error" && (
        <div className="w-full rounded-btn border border-bad/40 bg-bad/10 px-3 py-2 text-center text-xs text-bad">
          {error} {t("conn.errorSuffix")}
        </div>
      )}

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

function InfoTile({
  icon: Icon,
  label,
  value,
  mono,
  valueClass,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  mono?: boolean;
  valueClass?: string;
}) {
  return (
    <div className="glass ns-lift rounded-card px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-text-faint">
        <Icon size={13} /> {label}
      </div>
      <div
        className={cn("mt-1 truncate text-sm font-semibold text-text", mono && "font-mono", valueClass)}
        title={value}
      >
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
