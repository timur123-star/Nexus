import type { ReactNode } from "react";
import { RefreshCw, Trash2, CheckCircle2, AlertCircle, Clock, ShieldAlert } from "lucide-react";
import { useServerStore } from "../../store/useServerStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import type { Subscription } from "../../core/types";
import type { Lang } from "../../core/i18n";
import { cn } from "../../shared/lib/utils";

// Inline 4-language copy so the global dictionary (and its parity test) stays
// untouched, consistent with the other feature screens.
const SUB_STRINGS: Record<
  Lang,
  {
    empty: string;
    servers: string;
    refresh: string;
    remove: string;
    error: string;
    used: string;
    unlimited: string;
    expires: string;
    expired: string;
    insecureCert: string;
    daysLeft: (n: number) => string;
  }
> = {
  en: {
    empty: "No subscriptions yet. Add one via \u2018Add server \u2192 Subscription\u2019.",
    servers: "srv.",
    refresh: "Refresh",
    remove: "Remove (with servers)",
    error: "Update error",
    used: "used",
    unlimited: "unlimited",
    expires: "expires",
    expired: "expired",
    insecureCert: "self-signed certificate accepted",
    daysLeft: (n) => `${n} d left`,
  },
  ru: {
    empty: "Подписок нет. Добавьте их через «Добавить сервер → Подписка».",
    servers: "серв.",
    refresh: "Обновить",
    remove: "Удалить (с серверами)",
    error: "Ошибка обновления",
    used: "использовано",
    unlimited: "безлимит",
    expires: "до",
    expired: "истекла",
    insecureCert: "принят самоподписанный сертификат",
    daysLeft: (n) => `осталось ${n} дн.`,
  },
  fa: {
    empty: "هنوز اشتراکی نیست. از «افزودن سرور ← اشتراک» اضافه کنید.",
    servers: "سرور",
    refresh: "بروزرسانی",
    remove: "حذف (همراه سرورها)",
    error: "خطای بروزرسانی",
    used: "مصرف‌شده",
    unlimited: "نامحدود",
    expires: "انقضا",
    expired: "منقضی",
    insecureCert: "گواهی خودامضا پذیرفته شد",
    daysLeft: (n) => `${n} روز مانده`,
  },
  zh: {
    empty: "暂无订阅。通过“添加服务器 → 订阅”添加。",
    servers: "个",
    refresh: "刷新",
    remove: "删除（含服务器）",
    error: "更新错误",
    used: "已用",
    unlimited: "无限制",
    expires: "到期",
    expired: "已过期",
    insecureCert: "已接受自签名证书",
    daysLeft: (n) => `剩 ${n} 天`,
  },
};

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export function SubscriptionList() {
  const { subscriptions, refreshSubscription, removeSubscription } = useServerStore();
  const lang = useSettingsStore((s) => s.app.language);
  const S = SUB_STRINGS[lang] ?? SUB_STRINGS.en;

  if (subscriptions.length === 0) {
    return <p className="text-xs text-text-faint">{S.empty}</p>;
  }

  return (
    <div className="space-y-2">
      {subscriptions.map((sub) => (
        <div key={sub.id} className="flex items-center gap-3 rounded-btn bg-bg/40 px-3 py-2.5">
          <StatusIcon sub={sub} errorLabel={S.error} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-text">{sub.name}</div>
            <div className="truncate font-mono text-[11px] text-text-faint">{sub.url}</div>
            {sub.status === "error" && sub.lastError ? (
              <div className="truncate text-[11px] text-bad" title={sub.lastError}>
                {sub.lastError}
              </div>
            ) : null}
            {sub.status !== "error" && sub.insecureCertAccepted ? (
              <div className="flex items-center gap-1 truncate text-[11px] text-warn" title={S.insecureCert}>
                <ShieldAlert size={11} className="shrink-0" /> {S.insecureCert}
              </div>
            ) : null}
            <UsageRow sub={sub} S={S} />
          </div>
          <span className="shrink-0 text-xs text-text-dim">
            {sub.serverCount} {S.servers}
          </span>
          <button
            onClick={() => refreshSubscription(sub.id)}
            className="text-text-faint hover:text-indigo"
            title={S.refresh}
            aria-label={S.refresh}
          >
            <RefreshCw size={15} className={sub.status === "updating" ? "animate-spin-slow" : ""} />
          </button>
          <button
            onClick={() => removeSubscription(sub.id, true)}
            className="text-text-faint hover:text-bad"
            title={S.remove}
            aria-label={S.remove}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

function UsageRow({
  sub,
  S,
}: {
  sub: Subscription;
  S: (typeof SUB_STRINGS)[Lang];
}) {
  const u = sub.usage;
  if (!u) return null;
  const used = (u.upload || 0) + (u.download || 0);
  const total = u.total || 0;
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const danger = pct >= 90;
  // Expiry: epoch seconds. 0 ⇒ no expiry advertised.
  let expiryNode: ReactNode = null;
  if (u.expire > 0) {
    const msLeft = u.expire * 1000 - Date.now();
    if (msLeft <= 0) {
      expiryNode = <span className="text-bad">{S.expired}</span>;
    } else {
      const days = Math.ceil(msLeft / 86_400_000);
      const date = new Date(u.expire * 1000).toISOString().slice(0, 10);
      expiryNode = (
        <span className={days <= 3 ? "text-warn" : "text-text-faint"}>
          {S.expires} {date} · {S.daysLeft(days)}
        </span>
      );
    }
  }
  return (
    <div className="mt-1 space-y-1">
      {total > 0 ? (
        <>
          <div className="h-1 overflow-hidden rounded-full bg-bg">
            <div
              className={cn("h-full rounded-full", danger ? "bg-bad" : "bg-indigo")}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-text-faint">
            <span>
              {fmtBytes(used)} / {fmtBytes(total)} {S.used}
            </span>
            {expiryNode}
          </div>
        </>
      ) : (
        <div className="flex justify-between text-[10px] text-text-faint">
          <span>
            {fmtBytes(used)} · {S.unlimited}
          </span>
          {expiryNode}
        </div>
      )}
    </div>
  );
}

function StatusIcon({ sub, errorLabel }: { sub: Subscription; errorLabel: string }) {
  if (sub.status === "ok") return <CheckCircle2 size={16} className="shrink-0 text-ok" />;
  if (sub.status === "error")
    return (
      <span title={sub.lastError ?? errorLabel} className="shrink-0">
        <AlertCircle size={16} className="text-bad" />
      </span>
    );
  if (sub.status === "updating")
    return <RefreshCw size={16} className="shrink-0 animate-spin-slow text-warn" />;
  return <Clock size={16} className={cn("shrink-0 text-text-faint")} />;
}
