import { RefreshCw, Trash2, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { useServerStore } from "../../store/useServerStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import type { Subscription } from "../../core/types";
import type { Lang } from "../../core/i18n";
import { cn } from "../../shared/lib/utils";

// Inline 4-language copy so the global dictionary (and its parity test) stays
// untouched, consistent with the other feature screens.
const SUB_STRINGS: Record<
  Lang,
  { empty: string; servers: string; refresh: string; remove: string; error: string }
> = {
  en: {
    empty: "No subscriptions yet. Add one via \u2018Add server \u2192 Subscription\u2019.",
    servers: "srv.",
    refresh: "Refresh",
    remove: "Remove (with servers)",
    error: "Update error",
  },
  ru: {
    empty: "Подписок нет. Добавьте их через «Добавить сервер → Подписка».",
    servers: "серв.",
    refresh: "Обновить",
    remove: "Удалить (с серверами)",
    error: "Ошибка обновления",
  },
  fa: {
    empty: "هنوز اشتراکی نیست. از «افزودن سرور ← اشتراک» اضافه کنید.",
    servers: "سرور",
    refresh: "بروزرسانی",
    remove: "حذف (همراه سرورها)",
    error: "خطای بروزرسانی",
  },
  zh: {
    empty: "暂无订阅。通过“添加服务器 → 订阅”添加。",
    servers: "个",
    refresh: "刷新",
    remove: "删除（含服务器）",
    error: "更新错误",
  },
};

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
