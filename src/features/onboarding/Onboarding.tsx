import { useState } from "react";
import { Shield, Plus, Route, Power, ArrowRight } from "lucide-react";
import { useSettingsStore } from "../../store/useSettingsStore";
import { cn } from "../../shared/lib/utils";
import type { RoutingMode } from "../../core/types";

/**
 * First-run wizard: add a server → choose a mode → connect.
 * `importNode` lets the parent render the shared ImportDialog over the wizard.
 */
export function Onboarding({
  onDone,
  onImport,
  importNode,
}: {
  onDone: () => void;
  onImport: () => void;
  importNode: React.ReactNode;
}) {
  const [step, setStep] = useState(0);
  const setProxy = useSettingsStore((s) => s.setProxy);
  const mode = useSettingsStore((s) => s.proxy.routingMode);

  const steps = [
    {
      icon: Plus,
      title: "Добавьте сервер",
      body: "Вставьте ссылку (vless/vmess/trojan/ss), подписку или отсканируйте QR.",
      action: (
        <button
          onClick={onImport}
          className="rounded-btn bg-indigo px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-soft"
        >
          Добавить сервер
        </button>
      ),
    },
    {
      icon: Route,
      title: "Выберите режим",
      body: "Rule-based маршрутизирует трафик по правилам, Global — весь через прокси.",
      action: (
        <div className="flex gap-2">
          {(["global", "rule", "direct"] as RoutingMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setProxy({ routingMode: m })}
              className={cn(
                "rounded-btn border px-4 py-2 text-sm capitalize",
                mode === m ? "border-indigo bg-indigo/10 text-indigo" : "border-border text-text-dim",
              )}
            >
              {m}
            </button>
          ))}
        </div>
      ),
    },
    {
      icon: Power,
      title: "Подключайтесь",
      body: "Большая кнопка на главном экране включает и выключает VPN. Готово!",
      action: (
        <button
          onClick={onDone}
          className="rounded-btn bg-gradient-to-br from-indigo to-teal px-6 py-2.5 text-sm font-medium text-white"
        >
          Начать работу
        </button>
      ),
    },
  ];

  const cur = steps[step];
  const Icon = cur.icon;

  return (
    <div className="relative grid h-screen place-items-center p-8">
      <div className="glass-elev w-full max-w-md rounded-panel p-8 text-center">
        <div className="mb-6 flex items-center justify-center gap-2 text-indigo">
          <Shield size={22} />
          <span className="text-lg font-semibold tracking-wide text-text">NexusShield</span>
        </div>

        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-full bg-indigo/15 text-indigo">
          <Icon size={28} />
        </div>

        <h2 className="text-xl font-semibold text-text">{cur.title}</h2>
        <p className="mx-auto mt-2 max-w-xs text-sm text-text-dim">{cur.body}</p>

        <div className="mt-6 flex justify-center">{cur.action}</div>

        {/* Step dots + nav */}
        <div className="mt-8 flex items-center justify-between">
          <div className="flex gap-1.5">
            {steps.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === step ? "w-5 bg-indigo" : "w-1.5 bg-border",
                )}
              />
            ))}
          </div>
          {step < steps.length - 1 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              className="flex items-center gap-1 text-sm text-text-dim hover:text-text"
            >
              Далее <ArrowRight size={15} />
            </button>
          ) : (
            <button onClick={onDone} className="text-sm text-text-faint hover:text-text">
              Пропустить
            </button>
          )}
        </div>
      </div>

      {importNode}
    </div>
  );
}
