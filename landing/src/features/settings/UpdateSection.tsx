import { useState } from "react";
import { Download, RefreshCw, CheckCircle2, Sparkles } from "lucide-react";
import { useSettingsStore } from "../../store/useSettingsStore";
import { toast } from "../../store/useToastStore";
import { isTauri } from "../../core/ipc";
import { checkForUpdate, downloadAndInstallUpdate, type PendingUpdate } from "../../core/updater";
import type { Lang } from "../../core/i18n";

// Inline 4-language strings so the global dictionary (and its i18n parity test)
// stays untouched.
const UPDATE_STRINGS: Record<
  Lang,
  {
    title: string;
    intro: string;
    check: string;
    checking: string;
    upToDate: string;
    available: string;
    install: string;
    installing: string;
    downloading: string;
    failed: string;
    notInApp: string;
    notes: string;
  }
> = {
  en: {
    title: "Updates",
    intro:
      "Check for new signed releases and install them automatically. Updates are verified with the app's public key before they are applied.",
    check: "Check for updates",
    checking: "Checking…",
    upToDate: "You're on the latest version",
    available: "Version {v} is available",
    install: "Download & install",
    installing: "Installing…",
    downloading: "Downloading… {p}%",
    failed: "Update failed",
    notInApp: "Updates are available in the desktop app.",
    notes: "What's new",
  },
  ru: {
    title: "Обновления",
    intro:
      "Проверяйте новые подписанные релизы и устанавливайте их автоматически. Перед установкой обновление проверяется публичным ключом приложения.",
    check: "Проверить обновления",
    checking: "Проверка…",
    upToDate: "У вас последняя версия",
    available: "Доступна версия {v}",
    install: "Скачать и установить",
    installing: "Установка…",
    downloading: "Загрузка… {p}%",
    failed: "Не удалось обновить",
    notInApp: "Обновления доступны в десктоп-приложении.",
    notes: "Что нового",
  },
  fa: {
    title: "به‌روزرسانی‌ها",
    intro:
      "نسخه‌های امضاشده جدید را بررسی و به‌طور خودکار نصب کنید. هر به‌روزرسانی پیش از نصب با کلید عمومی برنامه تأیید می‌شود.",
    check: "بررسی به‌روزرسانی",
    checking: "در حال بررسی…",
    upToDate: "شما از آخرین نسخه استفاده می‌کنید",
    available: "نسخه {v} در دسترس است",
    install: "دانلود و نصب",
    installing: "در حال نصب…",
    downloading: "در حال دانلود… {p}%",
    failed: "به‌روزرسانی ناموفق بود",
    notInApp: "به‌روزرسانی‌ها در نسخه دسکتاپ در دسترس هستند.",
    notes: "تازه‌ها",
  },
  zh: {
    title: "更新",
    intro: "检查新的已签名版本并自动安装。更新在应用前会使用应用的公钥进行验证。",
    check: "检查更新",
    checking: "正在检查…",
    upToDate: "已是最新版本",
    available: "有可用版本 {v}",
    install: "下载并安装",
    installing: "正在安装…",
    downloading: "正在下载… {p}%",
    failed: "更新失败",
    notInApp: "更新在桌面应用中可用。",
    notes: "更新内容",
  },
};

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "uptodate" }
  | { kind: "available"; update: PendingUpdate }
  | { kind: "installing"; pct: number | null };

export function UpdateSection() {
  const lang = useSettingsStore((s) => s.app.language);
  const t = UPDATE_STRINGS[lang] ?? UPDATE_STRINGS.en;
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const onCheck = async () => {
    setStatus({ kind: "checking" });
    try {
      const update = await checkForUpdate();
      if (update) setStatus({ kind: "available", update });
      else setStatus({ kind: "uptodate" });
    } catch (e) {
      toast.error(`${t.failed}: ${e instanceof Error ? e.message : String(e)}`);
      setStatus({ kind: "idle" });
    }
  };

  const onInstall = async () => {
    setStatus({ kind: "installing", pct: null });
    try {
      await downloadAndInstallUpdate((p) => {
        if (p.phase === "downloading" && p.contentLength) {
          setStatus({
            kind: "installing",
            pct: Math.min(100, Math.round((p.downloaded / p.contentLength) * 100)),
          });
        }
      });
      // The app relaunches on success, so this line is rarely reached.
    } catch (e) {
      toast.error(`${t.failed}: ${e instanceof Error ? e.message : String(e)}`);
      setStatus({ kind: "idle" });
    }
  };

  const busy = status.kind === "checking" || status.kind === "installing";

  return (
    <section className="glass rounded-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-text">{t.title}</h3>
      <div className="space-y-3">
        <p className="text-[11px] text-text-faint">{t.intro}</p>

        {!isTauri && <p className="text-[11px] text-text-faint">{t.notInApp}</p>}

        {status.kind === "uptodate" && (
          <div className="flex items-center gap-1.5 text-sm text-ok">
            <CheckCircle2 size={15} /> {t.upToDate}
          </div>
        )}

        {status.kind === "available" && (
          <div className="space-y-2 rounded-btn border border-indigo/30 bg-indigo/5 p-3">
            <div className="flex items-center gap-1.5 text-sm font-medium text-text">
              <Sparkles size={15} className="text-indigo" />
              {t.available.replace("{v}", status.update.version)}
            </div>
            {status.update.notes && (
              <div className="text-[11px] text-text-dim">
                <span className="font-medium text-text-faint">{t.notes}: </span>
                <span className="whitespace-pre-wrap">{status.update.notes}</span>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {status.kind === "available" || status.kind === "installing" ? (
            <button
              type="button"
              onClick={onInstall}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-btn border border-indigo/40 bg-indigo/10 px-3 py-2 text-sm text-text transition-colors hover:bg-indigo/20 disabled:opacity-50"
            >
              <Download size={15} />
              {status.kind === "installing"
                ? status.pct == null
                  ? t.installing
                  : t.downloading.replace("{p}", String(status.pct))
                : t.install}
            </button>
          ) : (
            <button
              type="button"
              onClick={onCheck}
              disabled={busy || !isTauri}
              className="flex items-center gap-1.5 rounded-btn border border-border px-3 py-2 text-sm text-text-dim transition-colors hover:border-indigo/40 hover:text-text disabled:opacity-50"
            >
              <RefreshCw size={15} className={status.kind === "checking" ? "animate-spin" : ""} />
              {status.kind === "checking" ? t.checking : t.check}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
