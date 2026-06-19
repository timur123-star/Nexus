import { useState } from "react";
import { Globe2, MapPin, Building2, Network, ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { getExitInfo, type ExitInfo } from "../../core/ipc";
import { useConnectionStore } from "../../store/useConnectionStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { Flag } from "../../shared/components/Flag";
import { cn } from "../../shared/lib/utils";
import type { Lang } from "../../core/i18n";

// Screen-local strings — keeps the global i18n dictionary (and its parity
// test) untouched.
const STR: Record<
  Lang,
  {
    title: string;
    check: string;
    checking: string;
    recheck: string;
    idleHint: string;
    failed: string;
    tunneled: string;
    direct: string;
    leakWarn: string;
    ip: string;
    location: string;
    isp: string;
    edge: string;
  }
> = {
  en: {
    title: "Exit identity",
    check: "Check exit",
    checking: "Checking…",
    recheck: "Re-check",
    idleHint: "Reveals the public IP and country the outside world sees.",
    failed: "Couldn't reach the geo endpoint — check the connection.",
    tunneled: "Tunneled — traffic exits through the server",
    direct: "Direct — VPN is off, this is your real IP",
    leakWarn: "Exit country matches your real location — verify the tunnel is active",
    ip: "Exit IP",
    location: "Location",
    isp: "Provider",
    edge: "Edge",
  },
  ru: {
    title: "Точка выхода",
    check: "Проверить выход",
    checking: "Проверяю…",
    recheck: "Перепроверить",
    idleHint: "Показывает публичный IP и страну, которые видит внешний мир.",
    failed: "Не удалось обратиться к гео-сервису — проверьте соединение.",
    tunneled: "Через туннель — трафик выходит через сервер",
    direct: "Напрямую — VPN выключен, это ваш реальный IP",
    leakWarn: "Страна выхода совпадает с вашим реальным расположением — проверьте туннель",
    ip: "IP выхода",
    location: "Расположение",
    isp: "Провайдер",
    edge: "Узел",
  },
  fa: {
    title: "هویت خروج",
    check: "بررسی خروج",
    checking: "در حال بررسی…",
    recheck: "بررسی مجدد",
    idleHint: "IP عمومی و کشوری که دنیای بیرون می‌بیند را نشان می‌دهد.",
    failed: "دسترسی به سرویس جغرافیایی ممکن نشد — اتصال را بررسی کنید.",
    tunneled: "از طریق تونل — ترافیک از سرور خارج می‌شود",
    direct: "مستقیم — VPN خاموش است، این IP واقعی شماست",
    leakWarn: "کشور خروج با موقعیت واقعی شما یکی است — فعال بودن تونل را بررسی کنید",
    ip: "IP خروج",
    location: "موقعیت",
    isp: "ارائه‌دهنده",
    edge: "گره",
  },
  zh: {
    title: "出口身份",
    check: "检测出口",
    checking: "检测中…",
    recheck: "重新检测",
    idleHint: "显示外部世界看到的公网 IP 和国家/地区。",
    failed: "无法访问地理位置服务 — 请检查连接。",
    tunneled: "已隧道化 — 流量通过服务器出口",
    direct: "直连 — VPN 已关闭，这是你的真实 IP",
    leakWarn: "出口国家与你的真实位置相同 — 请确认隧道已生效",
    ip: "出口 IP",
    location: "位置",
    isp: "运营商",
    edge: "边缘节点",
  },
};

/** A coarse, never-throwing pretty name for an ISO alpha-2 code. */
function countryName(iso: string, lang: Lang): string {
  if (!iso) return "";
  try {
    const dn = new Intl.DisplayNames([lang], { type: "region" });
    return dn.of(iso.toUpperCase()) ?? iso.toUpperCase();
  } catch {
    return iso.toUpperCase();
  }
}

export function ExitInfoPanel() {
  const lang = useSettingsStore((s) => s.app.language) as Lang;
  const S = STR[lang] ?? STR.en;
  const mixedPort = useSettingsStore((s) => s.proxy.mixedPort);
  const status = useConnectionStore((s) => s.status);
  const connected = status === "connected" || status === "reconnecting";

  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Whether the *displayed* result was measured through the tunnel. Captured at
  // fetch time so the badge stays truthful even if the user disconnects after.
  const [tunneled, setTunneled] = useState(false);
  const [info, setInfo] = useState<ExitInfo | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const viaTunnel = connected;
    try {
      const r = await getExitInfo(viaTunnel ? mixedPort : 0);
      if (!r.ip) {
        setFailed(true);
        setInfo(null);
      } else {
        setInfo(r);
        setTunneled(viaTunnel);
      }
    } catch {
      setFailed(true);
      setInfo(null);
    } finally {
      setBusy(false);
    }
  }

  const iso = info?.country ? info.country.toLowerCase() : null;
  const place = info
    ? [info.city, countryName(info.country, lang)].filter(Boolean).join(", ")
    : "";

  return (
    <div className="glass rounded-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
          <Globe2 size={15} className="text-indigo" /> {S.title}
        </h3>
        <button
          onClick={run}
          disabled={busy}
          className={cn(
            "flex items-center gap-1.5 rounded-btn px-3 py-1.5 text-xs font-medium transition-colors",
            busy
              ? "cursor-not-allowed bg-surface text-text-faint"
              : "bg-indigo text-white hover:bg-indigo-soft",
          )}
        >
          {busy ? (
            <>
              <Loader2 size={13} className="animate-spin" /> {S.checking}
            </>
          ) : (
            <>{info ? S.recheck : S.check}</>
          )}
        </button>
      </div>

      {!info && !failed && <p className="mb-1 text-[11px] text-text-faint">{S.idleHint}</p>}
      {failed && <p className="mb-1 text-[11px] text-bad">{S.failed}</p>}

      {info && (
        <>
          <div
            className={cn(
              "mb-3 flex items-center gap-1.5 rounded-btn px-2.5 py-1.5 text-[11px] font-medium",
              tunneled ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn",
            )}
          >
            {tunneled ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}
            {tunneled ? S.tunneled : S.direct}
          </div>

          <div className="flex items-center gap-3">
            <Flag iso={iso} size={34} />
            <div className="min-w-0">
              <div className="truncate font-mono text-base font-semibold text-text">{info.ip}</div>
              <div className="truncate text-[11px] text-text-faint">{place || "—"}</div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field icon={MapPin} label={S.location} value={place || "—"} />
            <Field icon={Network} label={S.ip} value={info.ip} mono />
            <Field icon={Building2} label={S.isp} value={info.org || "—"} />
            <Field icon={Globe2} label={S.edge} value={info.colo || "—"} mono />
          </div>
        </>
      )}
    </div>
  );
}

function Field({
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
    <div className="rounded-card bg-bg/30 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-text-faint">
        <Icon size={12} className="text-indigo" /> {label}
      </div>
      <div
        className={cn(
          "mt-1 truncate text-sm font-medium text-text",
          mono && "font-mono",
        )}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}
