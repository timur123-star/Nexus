import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Shield, Plus, Route, Power, ArrowRight, ArrowLeft } from "lucide-react";
import { useSettingsStore } from "../../store/useSettingsStore";
import { cn } from "../../shared/lib/utils";
import { EASE_OUT } from "../../shared/lib/motion";
import { useT } from "../../core/i18n/useT";
import type { Lang, MessageKey } from "../../core/i18n";
import type { RoutingMode } from "../../core/types";

// Inline label so the global dictionary (and its parity test) stays untouched.
const BACK_LABEL: Record<Lang, string> = {
  en: "Back",
  ru: "Назад",
  fa: "بازگشت",
  zh: "返回",
};

// Slide + fade keyed by navigation direction so forward/back feel distinct.
const stepVariants = {
  enter: (dir: number) => ({ opacity: 0, x: dir >= 0 ? 28 : -28 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir >= 0 ? -28 : 28 }),
};

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
  const [dir, setDir] = useState(1);
  const setProxy = useSettingsStore((s) => s.setProxy);
  const mode = useSettingsStore((s) => s.proxy.routingMode);
  const lang = useSettingsStore((s) => s.app.language);
  const t = useT();

  const goTo = (next: number) => {
    setDir(next > step ? 1 : -1);
    setStep(next);
  };

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
  const isLast = step === steps.length - 1;
  const backLabel = BACK_LABEL[lang] ?? BACK_LABEL.en;

  return (
    <div className="relative grid h-screen place-items-center p-8">
      <div className="glass-elev w-full max-w-md rounded-panel p-8 text-center">
        <div className="mb-6 flex items-center justify-center gap-2 text-indigo">
          <Shield size={22} />
          <span className="text-lg font-semibold tracking-wide text-text">NexusShield</span>
        </div>

        <div className="min-h-[15rem] overflow-hidden">
          <AnimatePresence mode="wait" custom={dir} initial={false}>
            <motion.div
              key={step}
              custom={dir}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={ { duration: 0.28, ease: EASE_OUT } }
            >
              <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-full bg-indigo/15 text-indigo">
                <Icon size={28} />
              </div>

              <h2 className="text-xl font-semibold text-text">{cur.title}</h2>
              <p className="mx-auto mt-2 max-w-xs text-sm text-text-dim">{cur.body}</p>

              <div className="mt-6 flex justify-center">{cur.action}</div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Step dots + nav */}
        <div className="mt-8 grid grid-cols-3 items-center">
          <div className="flex justify-start">
            {step > 0 ? (
              <button
                onClick={() => goTo(step - 1)}
                className="flex items-center gap-1 text-sm text-text-dim transition-colors hover:text-text"
              >
                <ArrowLeft size={15} /> {backLabel}
              </button>
            ) : (
              <span />
            )}
          </div>
          <div className="flex justify-center gap-1.5">
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
          <div className="flex justify-end">
            {!isLast ? (
              <button
                onClick={() => goTo(step + 1)}
                className="flex items-center gap-1 text-sm text-text-dim transition-colors hover:text-text"
              >
                {t("onboarding.next")} <ArrowRight size={15} />
              </button>
            ) : (
              <button onClick={onDone} className="text-sm text-text-faint transition-colors hover:text-text">
                {t("onboarding.skip")}
              </button>
            )}
          </div>
        </div>
      </div>

      {importNode}
    </div>
  );
}
