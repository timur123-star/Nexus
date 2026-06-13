import { useState } from "react";
import { Shield, Plus, Route, Power, ArrowRight } from "lucide-react";
import { useSettingsStore } from "../../store/useSettingsStore";
import { cn } from "../../shared/lib/utils";
import { useT } from "../../core/i18n/useT";
import type { MessageKey } from "../../core/i18n";
import type { RoutingMode } from "../../core/types";

/**
 * First-run wizard: add a server \u2192 choose a mode \u2192 connect.
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
  const t = useT();

  const steps = [
    {
      icon: Plus,
      title: t("onboarding.step1.title"),
      body: t("onboarding.step1.body"),
      action: (
        <button
          onClick={onImport}
          className="rounded-btn bg-indigo px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-soft"
        >
          {t("import.title")}
        </button>
      ),
    },
    {
      icon: Route,
      title: t("onboarding.step2.title"),
      body: t("onboarding.step2.body"),
      action: (
        <div className="flex gap-2">
          {(["global", "rule", "direct"] as RoutingMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setProxy({ routingMode: m })}
              className={cn(
                "rounded-btn border px-4 py-2 text-sm",
                mode === m ? "border-indigo bg-indigo/10 text-indigo" : "border-border text-text-dim",
              )}
            >
              {t(`settings.routing.${m}.title` as MessageKey)}
            </button>
          ))}
        </div>
      ),
    },
    {
      icon: Power,
      title: t("onboarding.step3.title"),
      body: t("onboarding.step3.body"),
      action: (
        <button
          onClick={onDone}
          className="rounded-btn bg-gradient-to-br from-indigo to-teal px-6 py-2.5 text-sm font-medium text-white"
        >
          {t("onboarding.start")}
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
              {t("onboarding.next")} <ArrowRight size={15} />
            </button>
          ) : (
            <button onClick={onDone} className="text-sm text-text-faint hover:text-text">
              {t("onboarding.skip")}
            </button>
          )}
        </div>
      </div>

      {importNode}
    </div>
  );
}
