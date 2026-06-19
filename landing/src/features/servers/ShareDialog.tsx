/**
 * Share a single server as a copyable share-link + scannable QR code.
 * Inverse of the import flow — lets users move a config to another device or
 * hand it to a friend without retyping anything.
 *
 * Dialog strings are kept in a local Record<Lang,…> on purpose so they don't
 * have to be added to the global i18n dictionary (which enforces key parity).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { Check, Copy, QrCode, X } from "lucide-react";
import type { ServerProfile } from "../../core/types";
import { serverToShareLink } from "../../core/share/serialize";
import { useSettingsStore } from "../../store/useSettingsStore";
import { toast } from "../../store/useToastStore";
import type { Lang } from "../../core/i18n";

const STRINGS: Record<Lang, Record<string, string>> = {
  en: {
    title: "Share server",
    hint: "Anyone with this link can import the full config. Treat it like a password.",
    copy: "Copy link",
    copied: "Copied!",
    copyToast: "Share link copied to clipboard",
    qrAlt: "Server config QR code",
  },
  ru: {
    title: "Поделиться сервером",
    hint: "Любой, у кого есть эта ссылка, импортирует полную конфигурацию. Храните как пароль.",
    copy: "Скопировать ссылку",
    copied: "Скопировано!",
    copyToast: "Ссылка скопирована в буфер обмена",
    qrAlt: "QR-код конфигурации сервера",
  },
  fa: {
    title: "اشتراک‌گذاری سرور",
    hint: "هر کسی این لینک را داشته باشد می‌تواند کل پیکربندی را وارد کند. مثل رمز عبور با آن رفتار کنید.",
    copy: "کپی لینک",
    copied: "کپی شد!",
    copyToast: "لینک در کلیپ‌بورد کپی شد",
    qrAlt: "کد QR پیکربندی سرور",
  },
  zh: {
    title: "分享服务器",
    hint: "任何拥有此链接的人都可以导入完整配置，请像密码一样妥善保管。",
    copy: "复制链接",
    copied: "已复制！",
    copyToast: "分享链接已复制到剪贴板",
    qrAlt: "服务器配置二维码",
  },
};

export function ShareDialog({ server, onClose }: { server: ServerProfile; onClose: () => void }) {
  const lang = useSettingsStore((s) => s.app.language) as Lang;
  const tr = STRINGS[lang] ?? STRINGS.en;
  const [qr, setQr] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [qrError, setQrError] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Compute the share-link without any setState-during-render side effects
  // (which is what made the dialog flicker / "колбасить" on re-render). Only
  // depends on stable config fields, so live latency pings don't regenerate it.
  const { link, linkError } = useMemo(() => {
    try {
      return { link: serverToShareLink(server), linkError: null as string | null };
    } catch (e) {
      return { link: "", linkError: String(e instanceof Error ? e.message : e) };
    }
  }, [server]);
  const error = linkError ?? (qrError ? "qr" : null);

  useEffect(() => {
    if (!link) return;
    let alive = true;
    setQrError(false);
    QRCode.toDataURL(link, { margin: 1, width: 320, errorCorrectionLevel: "M" })
      .then((url) => {
        if (alive) setQr(url);
      })
      .catch(() => {
        if (alive) setQrError(true);
      });
    return () => {
      alive = false;
    };
  }, [link]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success(tr.copyToast);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error(tr.copyToast);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-elev animate-fade-in flex max-h-[90vh] w-full max-w-sm flex-col overflow-y-auto rounded-panel p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-text">
            <QrCode size={16} className="text-indigo" /> {tr.title}
          </h2>
          <button onClick={onClose} className="text-text-faint hover:text-text" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="mb-3 truncate text-center text-sm font-medium text-text">{server.name}</div>

        {error ? (
          <div className="rounded-card bg-bad/10 p-4 text-center text-sm text-bad">{error}</div>
        ) : (
          <div className="mx-auto grid aspect-square w-full max-w-[14rem] place-items-center rounded-card bg-white p-3">
            {qr ? (
              <img src={qr} alt={tr.qrAlt} className="h-full w-full object-contain" />
            ) : (
              <div className="h-full w-full animate-pulse rounded bg-black/5" />
            )}
          </div>
        )}

        <p className="mt-3 text-center text-[11px] leading-relaxed text-text-faint">{tr.hint}</p>

        <div className="mt-3 flex items-center gap-2 rounded-btn bg-bg/50 p-2">
          <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-dim">
            {link}
          </code>
        </div>

        <button
          onClick={copy}
          disabled={!link}
          className="ns-lift mt-3 flex items-center justify-center gap-2 rounded-btn bg-indigo py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-soft disabled:opacity-50"
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? tr.copied : tr.copy}
        </button>
      </div>
    </div>,
    document.body,
  );
}
