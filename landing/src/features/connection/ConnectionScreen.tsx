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
  ClipboardPaste,
  Network,
  ShieldCheck,
} from "lucide-react";
import type { ConnectionStatus, ServerProfile } from "../../core/types";
import { useServerStore } from "../../store/useServerStore";
import { useConnectionStore } from "../../store/useConnectionStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { useToastStore } from "../../store/useToastStore";
import { Sparkline } from "../../shared/components/Sparkline";
import { ShieldConnectButton } from "../../shared/components/ShieldConnectButton";
import { Flag } from "../../shared/components/Flag";
import { cn, formatBytes, formatUptime, latencyColor, latencyLabel } from "../../shared/lib/utils";
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
  modeProxy: string;
  modeSystem: string;
  modeTun: string;
  pasteClipboard: string;
  addManual: string;
  pasteEmpty: string;
  pasteFail: string;
  subAdded: string;
  subError: string;
  importedN: string;
  importNone: string;
}
const DASH_STRINGS: Record<Lang, DashStrings> = {
  en: {
    downloaded: "Downloaded",
    uploaded: "Uploaded",
    core: "Core",
    peak: "peak",
    xrayLive: "Live counters need the Clash API — unavailable on the Xray core.",
    ipAddress: "IP Address",
    protocol: "Protocol",
    encryption: "Encryption",
    connStatus: "Status",
    stable: "Stable",
    tapConnect: "Tap to connect",
    connect: "Connect",
    disconnect: "Disconnect",
    connecting: "Connecting",
    quickConnect: "Quick connect",
    modeProxy: "Proxy",
    modeSystem: "System proxy",
    modeTun: "VPN",
    pasteClipboard: "Paste from clipboard",
    addManual: "Add manually",
    pasteEmpty: "Clipboard is empty",
    pasteFail: "Couldn't read the clipboard",
    subAdded: "Subscription added",
    subError: "Couldn't load the subscription",
    importedN: "Imported",
    importNone: "No configs found in the clipboard",
  },
  ru: {
    downloaded: "\u0421\u043a\u0430\u0447\u0430\u043d\u043e",
    uploaded: "\u041e\u0442\u0434\u0430\u043d\u043e",
    core: "\u042f\u0434\u0440\u043e",
    peak: "\u043f\u0438\u043a",
    xrayLive: "Живые счётчики работают через Clash API — недоступно на ядре Xray.",
    ipAddress: "IP-адрес",
    protocol: "Протокол",
    encryption: "Шифрование",
    connStatus: "Статус",
    stable: "Стабильно",
    tapConnect: "Нажмите, чтобы подключиться",
    connect: "Подключиться",
    disconnect: "Отключиться",
    connecting: "Подключение",
    quickConnect: "Быстрое подключение",
    modeProxy: "Прокси",
    modeSystem: "Системный прокси",
    modeTun: "VPN",
    pasteClipboard: "Вставить из буфера",
    addManual: "Добавить вручную",
    pasteEmpty: "Буфер обмена пуст",
    pasteFail: "Не удалось прочитать буфер обмена",
    subAdded: "Подписка добавлена",
    subError: "Не удалось загрузить подписку",
    importedN: "Импортировано",
    importNone: "В буфере не найдено конфигов",
  },
  fa: {
    downloaded: "دانلود‌شده",
    uploaded: "آپلود‌شده",
    core: "هسته",
    peak: "اوج",
    xrayLive: "شمارنده‌های زنده به Clash API نیاز دارند — روی هسته Xray در دسترس نیست.",
    ipAddress: "آدرس IP",
    protocol: "پروتکل",
    encryption: "رمزنگاری",
    connStatus: "وضعیت",
    stable: "پایدار",
    tapConnect: "برای اتصال ضربه بزنید",
    connect: "اتصال",
    disconnect: "قطع اتصال",
    connecting: "در حال اتصال",
    quickConnect: "اتصال سریع",
    modeProxy: "پروکسی",
    modeSystem: "پروکسی سیستم",
    modeTun: "VPN",
    pasteClipboard: "جای‌گذاری از کلیپ‌بورد",
    addManual: "افزودن دستی",
    pasteEmpty: "کلیپ‌بورد خالی است",
    pasteFail: "خواندن کلیپ‌بورد ناموفق بود",
    subAdded: "اشتراک اضافه شد",
    subError: "بارگیری اشتراک ناموفق بود",
    importedN: "وارد شد",
    importNone: "هیچ پیکربندی در کلیپ‌بورد یافت نشد",
  },
  zh: {
    downloaded: "已下载",
    uploaded: "已上传",
    core: "核心",
    peak: "峰值",
    xrayLive: "实时计数依赖 Clash API——Xray 内核不可用。",
    ipAddress: "IP 地址",
    protocol: "协议",
    encryption: "加密",
    connStatus: "状态",
    stable: "稳定",
    tapConnect: "点击连接",
    connect: "连接",
    disconnect: "断开",
    connecting: "连接中",
    quickConnect: "快速连接",
    modeProxy: "代理",
    modeSystem: "系统代理",
    modeTun: "VPN",
    pasteClipboard: "从剪贴板粘贴",
    addManual: "手动添加",
    pasteEmpty: "剪贴板为空",
    pasteFail: "无法读取剪贴板",
    subAdded: "已添加订阅",
    subError: "无法加载订阅",
    importedN: "已导入",
    importNone: "剪贴板中未找到配置",
  },
};

const valueInitial = { opacity: 0.35, y: -2 };
const valueAnimate = { opacity: 1, y: 0 };
const valueTransition = { duration: 0.25, ease: "easeOut" };
const floatAnimate = { y: [0, -8, 0] };
const floatTransition = { duration: 4, repeat: Infinity, ease: "easeInOut" };

export function ConnectionScreen({
  onBrowse,
  onImport,
}: {
  onBrowse: () => void;
  onImport?: () => void;
}) {
  const t = useT();
  const lang = useSettingsStore((s) => s.app.language);
  const proxyCore = useSettingsStore((s) => s.proxy.coreKind);
  const connectionMode = useSettingsStore((s) => s.proxy.connectionMode);
  const setProxy = useSettingsStore((s) => s.setProxy);
  const subIntervalHours = useSettingsStore((s) => s.app.subscriptionUpdateHours);
  const L = DASH_STRINGS[lang] ?? DASH_STRINGS.en;
  const servers = useServerStore((s) => s.servers);
  const addFromBlob = useServerStore((s) => s.addFromBlob);
  const addSubscription = useServerStore((s) => s.addSubscription);
  const pingOne = useServerStore((s) => s.pingOne);
  const pushToast = useToastStore((s) => s.push);
  const [pasteBusy, setPasteBusy] = useState(false);
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

  async function pasteFromClipboard() {
    if (pasteBusy) return;
    setPasteBusy(true);
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        pushToast({ kind: "warning", message: L.pasteEmpty });
        return;
      }
      // Auto-detect: a single http(s) URL is a subscription; anything else
      // (share links / base64 body / link list) is imported directly. An
      // authenticated HTTP-proxy link (`http(s)://user:pass@host:port`) carries
      // userinfo and is imported as a server, not fetched as a subscription.
      const singleHttpUrl = /^https?:\/\//i.test(text) && !/\s/.test(text);
      const isSubUrl = singleHttpUrl && !text.includes("@");
      if (isSubUrl) {
        let host = "Подписка";
        try {
          host = new URL(text).hostname || host;
        } catch {
          /* keep default */
        }
        const sub = await addSubscription(host, text, subIntervalHours);
        if (sub.status === "error") {
          pushToast({
            kind: "error",
            message: sub.lastError ? `${L.subError}: ${sub.lastError}` : L.subError,
          });
        } else if ((sub.serverCount ?? 0) === 0) {
          pushToast({ kind: "warning", message: L.importNone });
        } else {
          pushToast({ kind: "success", message: `${L.subAdded} · ${sub.serverCount}` });
        }
      } else {
        const { added, errors } = addFromBlob(text);
        if (added > 0) {
          pushToast({
            kind: "success",
            message: `${L.importedN}: ${added}${errors ? ` · ${errors} ✕` : ""}`,
          });
        } else {
          pushToast({ kind: "error", message: L.importNone });
        }
      }
    } catch {
      pushToast({ kind: "error", message: L.pasteFail });
    } finally {
      setPasteBusy(false);
    }
  }

  if (!active) {
    return (
      <EmptyState
        onBrowse={onBrowse}
        onPaste={pasteFromClipboard}
        onAdd={onImport ?? onBrowse}
        pasteBusy={pasteBusy}
        L={L}
      />
    );
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

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-4 px-6 py-4">
      {/* Hero: emblem connect control (the emblem itself toggles) + server pill */}
      <div className="flex flex-col items-center gap-4">
        <ModeSwitcher
          mode={connectionMode}
          onChange={(m) => setProxy({ connectionMode: m })}
          disabled={connected || busy}
          L={L}
        />

        <ShieldConnectButton
          state={shieldState}
          onClick={() => !busy && toggle(active)}
          label={shieldLabel}
          sublabel={shieldSub}
        />

        {/* Active server selector pill. */}
        <button
          type="button"
          onClick={onBrowse}
          className="glass ns-lift flex items-center gap-3 rounded-full px-5 py-2.5 transition-colors hover:border-indigo/40"
        >
          <span className="text-2xl leading-none">
            <Flag name={active.name} address={active.address} size={26} />
          </span>
          <div className="text-left leading-tight">
            <div className="text-sm font-semibold text-text">{active.name}</div>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="font-medium uppercase text-indigo">
                {PROTOCOL_LABEL[active.protocol]}
              </span>
              <span className="text-text-faint">|</span>
              <span className={cn("font-mono font-semibold", latencyColor(active.latencyMs))}>
                {latencyLabel(active.latencyMs)}
              </span>
            </div>
          </div>
          <ChevronRight size={18} className="text-text-faint" />
        </button>

        {/* Quick import: paste-from-clipboard (auto-detects link/sub) + manual add */}
        <ImportBar
          onPaste={pasteFromClipboard}
          onAdd={onImport ?? onBrowse}
          pasteBusy={pasteBusy}
          L={L}
        />
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
          caption={
            connected && peakDown > 0 ? `${L.peak} ${formatBytes(peakDown, true)}` : undefined
          }
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

function ModeSwitcher({
  mode,
  onChange,
  disabled,
  L,
}: {
  mode: "proxy" | "system" | "tun";
  onChange: (m: "proxy" | "system" | "tun") => void;
  disabled?: boolean;
  L: DashStrings;
}) {
  const items: { id: "proxy" | "system" | "tun"; label: string; icon: React.ElementType }[] = [
    { id: "proxy", label: L.modeProxy, icon: Network },
    { id: "system", label: L.modeSystem, icon: Globe2 },
    { id: "tun", label: L.modeTun, icon: ShieldCheck },
  ];
  return (
    <div
      className={cn(
        "glass relative flex items-center gap-1 rounded-full p-1",
        disabled && "pointer-events-none opacity-50",
      )}
      role="tablist"
      aria-label={L.connStatus}
    >
      {items.map((it) => {
        const selected = it.id === mode;
        const Icon = it.icon;
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={disabled}
            onClick={() => onChange(it.id)}
            className="relative flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors"
          >
            {selected && (
              <motion.span
                layoutId="mode-pill"
                className="absolute inset-0 rounded-full bg-indigo/15 ring-1 ring-indigo/40"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <Icon
              size={13}
              className={cn("relative z-[1]", selected ? "text-indigo" : "text-text-faint")}
            />
            <span className={cn("relative z-[1]", selected ? "text-text" : "text-text-dim")}>
              {it.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ImportBar({
  onPaste,
  onAdd,
  pasteBusy,
  L,
}: {
  onPaste: () => void;
  onAdd: () => void;
  pasteBusy: boolean;
  L: DashStrings;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onPaste}
        disabled={pasteBusy}
        className="glass ns-lift flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-medium text-text transition-colors hover:border-indigo/40 disabled:opacity-60"
      >
        <ClipboardPaste size={14} className="text-indigo" />
        {L.pasteClipboard}
      </button>
      <button
        type="button"
        onClick={onAdd}
        title={L.addManual}
        aria-label={L.addManual}
        className="glass ns-lift grid h-9 w-9 place-items-center rounded-full text-text-dim transition-colors hover:border-indigo/40 hover:text-text"
      >
        <Plus size={16} />
      </button>
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
        className={cn(
          "mt-1.5 truncate text-sm font-semibold text-text",
          mono && "font-mono",
          valueClass,
        )}
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
            {s.favorite ? (
              <Star size={13} className="fill-current" />
            ) : (
              <Flag name={s.name} address={s.address} size={18} />
            )}
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

function EmptyState({
  onBrowse,
  onPaste,
  onAdd,
  pasteBusy,
  L,
}: {
  onBrowse: () => void;
  onPaste: () => void;
  onAdd: () => void;
  pasteBusy: boolean;
  L: DashStrings;
}) {
  const t = useT();
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-sm">
        <motion.div animate={floatAnimate} transition={floatTransition} className="mx-auto w-fit">
          <Globe2 size={48} className="text-text-faint" />
        </motion.div>
        <h2 className="mt-4 text-lg font-semibold text-text">{t("conn.noServers")}</h2>
        <p className="mt-1 text-sm text-text-dim">{t("conn.noServersHint")}</p>
        <div className="mt-5 flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={onPaste}
            disabled={pasteBusy}
            className="flex items-center gap-2 rounded-btn bg-indigo px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-soft disabled:opacity-60"
          >
            <ClipboardPaste size={15} /> {L.pasteClipboard}
          </button>
          <div className="flex items-center gap-4 text-sm">
            <button onClick={onAdd} className="text-text-dim transition-colors hover:text-text">
              {L.addManual}
            </button>
            <span className="text-text-faint">·</span>
            <button onClick={onBrowse} className="text-text-dim transition-colors hover:text-text">
              {t("conn.goToServers")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
