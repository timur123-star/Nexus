import { useState } from "react";
import { motion } from "framer-motion";
import { Gauge, ArrowDown, ArrowUp, Activity, Waves, Loader2 } from "lucide-react";
import { runSpeedTest, type SpeedTestResult } from "../../core/ipc";
import { useConnectionStore } from "../../store/useConnectionStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { cn } from "../../shared/lib/utils";
import type { Lang } from "../../core/i18n";

// Screen-local strings — keeps the global i18n dictionary (and its parity test)
// untouched.
const STR: Record<
  Lang,
  {
    title: string;
    run: string;
    running: string;
    rerun: string;
    download: string;
    upload: string;
    latency: string;
    jitter: string;
    idleHint: string;
    direct: string;
    failed: string;
  }
> = {
  en: {
    title: "Speed test",
    run: "Run test",
    running: "Testing…",
    rerun: "Run again",
    download: "Download",
    upload: "Upload",
    latency: "Latency",
    jitter: "Jitter",
    idleHint: "Connect to a server to measure tunneled speed.",
    direct: "Not connected — measuring the direct connection.",
    failed: "Speed test failed — check the connection and try again.",
  },
  ru: {
    title: "Тест скорости",
    run: "Запустить тест",
    running: "Тестирую…",
    rerun: "Ещё раз",
    download: "Загрузка",
    upload: "Отдача",
    latency: "Задержка",
    jitter: "Джиттер",
    idleHint: "Подключитесь к серверу, чтобы измерить скорость через туннель.",
    direct: "Нет подключения — измеряю прямое соединение.",
    failed: "Тест не удался — проверьте соединение и попробуйте снова.",
  },
  fa: {
    title: "تست سرعت",
    run: "اجرای تست",
    running: "در حال تست…",
    rerun: "اجرای دوباره",
    download: "دانلود",
    upload: "آپلود",
    latency: "تأخیر",
    jitter: "جیتر",
    idleHint: "برای سنجش سرعت تونل به یک سرور متصل شوید.",
    direct: "متصل نیستید — اتصال مستقیم سنجیده می‌شود.",
    failed: "تست سرعت ناموفق بود — اتصال را بررسی و دوباره تلاش کنید.",
  },
  zh: {
    title: "速度测试",
    run: "开始测试",
    running: "测试中…",
    rerun: "再次测试",
    download: "下载",
    upload: "上传",
    latency: "延迟",
    jitter: "抖动",
    idleHint: "连接到服务器以测量隧道速度。",
    direct: "未连接 — 正在测量直连速度。",
    failed: "速度测试失败 — 请检查连接后重试。",
  },
};

function fmtMbps(v: number): string {
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

/** Map throughput to a 0-100 bar width on a soft log scale (1 Gbps ≈ full). */
function barPct(mbps: number): number {
  if (mbps <= 0) return 0;
  const pct = (Math.log10(mbps + 1) / Math.log10(1001)) * 100;
  return Math.max(2, Math.min(100, pct));
}

export function SpeedTestPanel() {
  const lang = useSettingsStore((s) => s.app.language) as Lang;
  const S = STR[lang] ?? STR.en;
  const mixedPort = useSettingsStore((s) => s.proxy.mixedPort);
  const status = useConnectionStore((s) => s.status);
  const connected = status === "connected" || status === "reconnecting";

  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState<SpeedTestResult | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const r = await runSpeedTest(connected ? mixedPort : 0);
      if (r.downMbps <= 0 && r.upMbps <= 0) {
        setFailed(true);
        setResult(null);
      } else {
        setResult(r);
      }
    } catch {
      setFailed(true);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass rounded-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
          <Gauge size={15} className="text-indigo" /> {S.title}
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
              <Loader2 size={13} className="animate-spin" /> {S.running}
            </>
          ) : (
            <>{result ? S.rerun : S.run}</>
          )}
        </button>
      </div>

      {!connected && (
        <p className="mb-3 text-[11px] text-text-faint">{result || busy ? S.direct : S.idleHint}</p>
      )}
      {failed && <p className="mb-3 text-[11px] text-bad">{S.failed}</p>}

      <div className="grid grid-cols-2 gap-3">
        <Metric
          icon={ArrowDown}
          color="var(--color-teal)"
          label={S.download}
          value={result ? fmtMbps(result.downMbps) : "—"}
          unit="Mbps"
          pct={result ? barPct(result.downMbps) : 0}
          busy={busy}
        />
        <Metric
          icon={ArrowUp}
          color="var(--color-indigo)"
          label={S.upload}
          value={result ? fmtMbps(result.upMbps) : "—"}
          unit="Mbps"
          pct={result ? barPct(result.upMbps) : 0}
          busy={busy}
        />
        <Metric
          icon={Activity}
          color="var(--color-teal)"
          label={S.latency}
          value={result ? result.latencyMs.toFixed(0) : "—"}
          unit="ms"
          pct={result ? Math.max(2, Math.min(100, 100 - result.latencyMs / 4)) : 0}
          busy={busy}
        />
        <Metric
          icon={Waves}
          color="var(--color-indigo)"
          label={S.jitter}
          value={result ? result.jitterMs.toFixed(1) : "—"}
          unit="ms"
          pct={result ? Math.max(2, Math.min(100, 100 - result.jitterMs * 3)) : 0}
          busy={busy}
        />
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  color,
  label,
  value,
  unit,
  pct,
  busy,
}: {
  icon: React.ElementType;
  color: string;
  label: string;
  value: string;
  unit: string;
  pct: number;
  busy: boolean;
}) {
  return (
    <div className="rounded-card bg-bg/30 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-text-faint">
        <Icon size={12} style={{ color }} /> {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="font-mono text-xl font-semibold text-text">{value}</span>
        <span className="text-[10px] text-text-faint">{unit}</span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={false}
          animate={{ width: busy ? "100%" : `${pct}%`, opacity: busy ? 0.4 : 1 }}
          transition={{ duration: 0.5 }}
        />
      </div>
    </div>
  );
}
