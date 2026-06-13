import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Zap,
  Globe2,
  ChevronRight,
  Download,
  Upload,
  Cpu,
  Lock,
  Activity,
  Crosshair,
  Plus,
  Star,
} from "lucide-react";
import type { ConnectionStatus, ServerProfile } from "../../core/types";
import { useServerStore } from "../../store/useServerStore";
import { useConnectionStore } from "../../store/useConnectionStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { Sparkline } from "../../shared/components/Sparkline";
import { ShieldConnectButton } from "../../shared/components/ShieldConnectButton";
import { cn, formatBytes, formatUptime, latencyColor, latencyLabel } from "../../shared/lib/utils";
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
  tapConnect: string;
  connect: string;
  disconnect: string;
  connecting: string;
  quickConnect: string;
}
const DASH_STRINGS: Record<Lang, DashStrings> = {
  en: {
    downloaded: "Downloaded", uploaded: "Uploaded", core: "Core", peak: "peak",
    xrayLive: "Live counters need the Clash API — unavailable on the Xray core.",
    ipAddress: "IP Address", protocol: "Protocol", encryption: "Encryption", connStatus: "Status",
    stable: "Stable", tapConnect: "Tap to connect",
    connect: "Connect", disconnect: "Disconnect", connecting: "Connecting", quickConnect: "Quick connect",
  },
  ru: {
    downloaded: "\u0421\u043a\u0430\u0447\u0430\u043d\u043e", uploaded: "\u041e\u0442\u0434\u0430\u043d\u043e", core: "\u042f\u0434\u0440\u043e", peak: "\u043f\u0438\u043a",
    xrayLive: "Живые счётчики работают через Clash API — недоступно на ядре Xray.",
    ipAddress: "IP-адрес", protocol: "Протокол", encryption: "Шифрование", connStatus: "Статус",
    stable: "Стабильно", tapConnect: "Нажмите, чтобы подключиться",
    connect: "Подключиться", disconnect: "Отключиться", connecting: "Подключение", quickConnect: "Быстрое подключение",
  },
  fa: {
    downloaded: "دانلود‌شده", uploaded: "آپلود‌شده", core: "هسته", peak: "اوج",
    xrayLive: "شمارنده‌های زنده به Clash API نیاز دارند — روی هسته Xray در دسترس نیست.",
    ipAddress: "آدرس IP", protocol: "پروتکل", encryption: "رمزنگاری", connStatus: "وضعیت",
    stable: "پایدار", tapConnect: "برای اتصال ضربه بزنید",
    connect: "اتصال", disconnect: "قطع اتصال", connecting: "در حال اتصال", quickConnect: "اتصال سریع",
  },
  zh: {
    downloaded: "已下载", uploaded: "已上传", core: "核心", peak: "峰值",
    xrayLive: "实时计数依赖 Clash API——Xray 内核不可用。",
    ipAddress: "IP 地址", protocol: "协议", encryption: "加密", connStatus: "状态",
    stable: "稳定", tapConnect: "点击连接",
    connect: "连接", disconnect: "断开", connecting: "连接中", quickConnect: "快速连接",
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
  const { status, activeServerId, activeCore, connectedAt, traffic, samples, toggle, connect } =
    useConnectionStore();

  const active =
    servers.find((s) => s.id === activeServerId) ??
    [...servers].sort((a, b) => (a.latencyMs ?? 9999) - (b.latencyMs ?? 9999))[0];

  const connected = status === "connected";
  const busy = status === "connecting" || status === "reconnecting";
  const xrayActive = connected && activeCore === "xray";

  // Quick-connect shortcuts: favourites first, then best-ping servers.
  const quickServers = useMemo(() => {
    const favs = servers.filter((s) => s.favorite);
    const rest = [...servers]
      .filter((s) => !s.favorite)
      .sort((a, b) => (a.latencyMs ?? 9999) - (b.latencyMs ?? 9999));
    return [...favs, ...rest].slice(0, 5);
  }, [servers]);

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
  // Nameplate shows the live connection STATE (Подключено / Подключение / Отключено).
  const shieldLabel = t(STATUS_LABEL_KEY[status]).replace("\u2026", "");
  const shieldSub = connected ? uptime || `0${unitS}` : busy ? "\u2026" : L.tapConnect;
  const shownCore = (connected || busy) && activeCore ? activeCore : proxyCore;
  const coreLabel = shownCore === "xray" ? "Xray" : "sing-box";
  const dash = "\u2014";
  const encryption = active.tls.security !== "none" ? active.tls.security.toUpperCase() : "AES-256";
  const statusText = connected ? L.stable : t(STATUS_LABEL_KEY[status]);
  const actionLabel = busy ? L.connecting : connected ? L.disconnect : L.connect;

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-4 px-6 py-4">
      {/* Hero: emblem connect control + action button + server pill */}
      <div className="flex flex-col items-center gap-3">
        <ShieldConnectButton
          state={shieldState}
          onClick={() => toggle(active)}
          label={shieldLabel}
          sublabel={shieldSub}
        />

        {/* Primary action button (Подключиться / Отключиться). */}
        <motion.button
          type="button"
          onClick={() => toggle(active)}
          disabled={busy}
          whileHover={busy ? undefined : { scale: 1.02 }}
          whileTap={busy ? undefined : { scale: 0.97 }}
          className={cn(
            "relative min-w-[230px] rounded-btn border px-10 py-3 text-sm font-semibold uppercase tracking-[0.18em] transition-colors disabled:cursor-wait",
            connected
              ? "border-indigo/70 bg-indigo/10 text-white shadow-[0_0_22px_rgba(220,38,38,0.35)] hover:bg-indigo/20"
              : busy
                ? "border-indigo/40 bg-indigo/5 text-indigo-soft"
                : "border-indigo/60 bg-indigo/15 text-white shadow-[0_0_22px_rgba(220,38,38,0.3)] hover:bg-indigo/25",
          )}
        >
          {actionLabel}
          {busy && "\u2026"}
        </motion.button>

        {/* Active server selector pill. */}
        <button
          type="button"
          onClick={onBrowse}
          className="glass ns-lift flex items-center gap-3 rounded-full px-5 py-2.5 transition-colors hover:border-indigo/40"
        >
          <span className="text-2xl leading-none">{flagFor(active.name)}</span>
          <div className="text-left leading-tight">
            <div className="text-sm font-semibold text-text">{active.name}</div>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="font-medium uppercase text-indigo">{PROTOCOL_LABEL[active.protocol]}</span>
              <span className="text-text-faint">|</span>
              <span className={cn("font-mono font-semibold", latencyColor(active.latencyMs))}>
                {latencyLabel(active.latencyMs)}
              </span>
            </div>
          </div>
          <ChevronRight size={18} className="text-text-faint" />
        </button>
      </div>

      {/* Bottom panel ─────────────────────────────────────────────── */}
      {/* Row 1 — connection facts */}
      <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4">
        <InfoTile icon={Crosshair} label={L.ipAddress} value={active.address} mono />
        <InfoTile icon={Zap} label={L.protocol} value={PROTOCOL_LABEL[active.protocol]} />
        <InfoTile icon={Lock} label={L.encryption} value={encryption} mono />
        <InfoTile
          icon={Activity}
          label={L.connStatus}
          value={statusText}
          valueClass={connected ? "text-ok" : busy ? "text-warn" : "text-text-dim"}
        />
      </div>

      {/* Row 2 — live throughput graphs */}
      <div className="grid w-full grid-cols-2 gap-3">
        <ThroughputTile
          label={t("conn.download")}
          value={formatBytes(traffic.down, true)}
          caption={connected && peakDown > 0 ? `${L.peak} ${formatBytes(peakDown, true)}` : undefined}
          series={downSeries}
          color="var(--color-indigo)"
        />
        <ThroughputTile
          label={t("conn.upload")}
          value={formatBytes(traffic.up, true)}
          caption={connected && peakUp > 0 ? `${L.peak} ${formatBytes(peakUp, true)}` : undefined}
          series={upSeries}
          color="var(--color-indigo-soft)"
        />
      </div>

      {/* Row 3 — session totals + quick connect */}
      <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4">
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
        <QuickConnectTile
          title={L.quickConnect}
          servers={quickServers}
          activeId={active.id}
          onPick={(s) => void connect(s)}
          onMore={onBrowse}
        />
      </div>

      {xrayActive && (
        <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-text-faint">
          <Cpu size={11} /> {L.xrayLive}
        </p>
      )}
    </div>
  );
}

function ThroughputTile({
  label,
  value,
  caption,
  series,
  color,
}: {
  label: string;
  value: string;
  caption?: string;
  series: number[];
  color: string;
}) {
  return (
    <div className="glass ns-lift rounded-card p-3.5">
      <div className="flex items-start justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-faint">
          <Activity size={12} className="text-indigo" /> {label}
        </span>
        <div className="text-right">
          <motion.div
            key={value}
            initial={valueInitial}
            animate={valueAnimate}
            transition={valueTransition}
            className="font-mono text-base font-semibold text-text"
          >
            {value}
          </motion.div>
          <div className="h-3 text-[10px] text-text-faint">{caption ?? ""}</div>
        </div>
      </div>
      <div className="mt-1">
        <Sparkline data={series} width={240} height={30} color={color} responsive />
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
    <div className="glass ns-lift rounded-card px-3.5 py-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-text-faint">
        <Icon size={13} className="text-indigo" /> {label}
      </div>
      <div
        className={cn("mt-1.5 truncate text-sm font-semibold text-text", mono && "font-mono", valueClass)}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function QuickConnectTile({
  title,
  servers,
  activeId,
  onPick,
  onMore,
}: {
  title: string;
  servers: ServerProfile[];
  activeId: string;
  onPick: (s: ServerProfile) => void;
  onMore: () => void;
}) {
  return (
    <div className="glass ns-lift rounded-card px-3.5 py-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-text-faint">
        <Plus size={12} className="text-indigo" /> {title}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        {servers.map((s) => (
          <button
            key={s.id}
            type="button"
            title={s.name}
            onClick={() => onPick(s)}
            className={cn(
              "grid h-7 w-7 shrink-0 place-items-center rounded-btn border text-xs transition-colors",
              s.id === activeId
                ? "border-indigo/70 bg-indigo/15 text-indigo"
                : "border-border bg-bg-elev/40 text-text-dim hover:border-indigo/40 hover:text-text",
            )}
          >
            {s.favorite ? <Star size={13} className="fill-current" /> : <span className="text-base leading-none">{flagFor(s.name)}</span>}
          </button>
        ))}
        <button
          type="button"
          onClick={onMore}
          title={title}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-btn border border-border bg-bg-elev/40 text-text-dim transition-colors hover:border-indigo/40 hover:text-text"
        >
          <ChevronRight size={14} />
        </button>
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
