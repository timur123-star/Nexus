import { RefreshCw, Trash2, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { useServerStore } from "../../store/useServerStore";
import type { Subscription } from "../../core/types";
import { cn } from "../../shared/lib/utils";

export function SubscriptionList() {
  const { subscriptions, refreshSubscription, removeSubscription } = useServerStore();

  if (subscriptions.length === 0) {
    return (
      <p className="text-xs text-text-faint">
        Подписок нет. Добавьте их через «Добавить сервер → Подписка».
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {subscriptions.map((sub) => (
        <div key={sub.id} className="flex items-center gap-3 rounded-btn bg-bg/40 px-3 py-2.5">
          <StatusIcon sub={sub} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-text">{sub.name}</div>
            <div className="truncate font-mono text-[11px] text-text-faint">{sub.url}</div>
            {sub.status === "error" && sub.lastError ? (
              <div className="truncate text-[11px] text-bad" title={sub.lastError}>
                {sub.lastError}
              </div>
            ) : null}
          </div>
          <span className="shrink-0 text-xs text-text-dim">{sub.serverCount} серв.</span>
          <button
            onClick={() => refreshSubscription(sub.id)}
            className="text-text-faint hover:text-indigo"
            title="Обновить"
          >
            <RefreshCw size={15} className={sub.status === "updating" ? "animate-spin-slow" : ""} />
          </button>
          <button
            onClick={() => removeSubscription(sub.id, true)}
            className="text-text-faint hover:text-bad"
            title="Удалить (с серверами)"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

function StatusIcon({ sub }: { sub: Subscription }) {
  if (sub.status === "ok") return <CheckCircle2 size={16} className="shrink-0 text-ok" />;
  if (sub.status === "error")
    return (
      <span title={sub.lastError ?? "Ошибка обновления"} className="shrink-0">
        <AlertCircle size={16} className="text-bad" />
      </span>
    );
  if (sub.status === "updating")
    return <RefreshCw size={16} className="shrink-0 animate-spin-slow text-warn" />;
  return <Clock size={16} className={cn("shrink-0 text-text-faint")} />;
}
