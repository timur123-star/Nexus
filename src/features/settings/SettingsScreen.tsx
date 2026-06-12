import { useEffect, useState } from "react";
import { Folder, Plus, RotateCcw, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { useSettingsStore } from "../../store/useSettingsStore";
import { openLogsDir, isElevated, relaunchAsAdmin } from "../../core/ipc";
import { cn } from "../../shared/lib/utils";
import { useT } from "../../core/i18n/useT";
import type { MessageKey } from "../../core/i18n";
import type { CoreKind, RoutingMode, RoutingRuleMatch, RoutingTarget } from "../../core/types";
import { SubscriptionList } from "./SubscriptionList";

const MATCH_KEYS: RoutingRuleMatch[] = [
  "domain",
  "domain_suffix",
  "domain_keyword",
  "ip_cidr",
  "process_name",
];
const TARGET_KEYS: RoutingTarget[] = ["proxy", "direct", "block"];

const CORE_TITLE: Record<CoreKind, string> = {
  "sing-box": "sing-box",
  xray: "Xray-core",
};

const MATCH_PLACEHOLDER: Record<RoutingRuleMatch, string> = {
  domain: "example.com",
  domain_suffix: ".openai.com",
  domain_keyword: "google",
  ip_cidr: "10.0.0.0/8",
  process_name: "telegram.exe",
};

export function SettingsScreen() {
  const { proxy, app, setProxy, setApp, reset } = useSettingsStore();
  const [elevated, setElevated] = useState(true);
  const t = useT();

  useEffect(() => {
    isElevated().then(setElevated);
  }, []);

  const addRule = () =>
    setProxy({
      customRules: [
        ...proxy.customRules,
        { match: "domain_suffix", value: "", target: "proxy" },
      ],
    });
  const updateRule = (idx: number, patch: Partial<{ match: RoutingRuleMatch; value: string; target: RoutingTarget }>) =>
    setProxy({
      customRules: proxy.customRules.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    });
  const removeRule = (idx: number) =>
    setProxy({ customRules: proxy.customRules.filter((_, i) => i !== idx) });

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-5">
      <Section title={t("settings.core.title")}>
        <div className="grid grid-cols-2 gap-2">
          {(["sing-box", "xray"] as CoreKind[]).map((k) => (
            <button
              key={k}
              onClick={() => setProxy({ coreKind: k })}
              className={cn(
                "rounded-btn border px-3 py-3 text-sm transition-colors",
                proxy.coreKind === k
                  ? "border-indigo bg-indigo/10 text-indigo"
                  : "border-border text-text-dim hover:text-text",
              )}
            >
              <div className="font-medium">{CORE_TITLE[k]}</div>
              <div className="mt-0.5 text-[11px] text-text-faint">
                {t(k === "sing-box" ? "settings.core.singbox.sub" : "settings.core.xray.sub")}
              </div>
            </button>
          ))}
        </div>
      </Section>

      <Section title={t("settings.routing.title")}>
        <div className="grid grid-cols-3 gap-2">
          {(["global", "rule", "direct"] as RoutingMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setProxy({ routingMode: m })}
              className={cn(
                "rounded-btn border px-3 py-3 text-sm transition-colors",
                proxy.routingMode === m
                  ? "border-indigo bg-indigo/10 text-indigo"
                  : "border-border text-text-dim hover:text-text",
              )}
            >
              <div className="font-medium">{t(`settings.routing.${m}.title` as MessageKey)}</div>
              <div className="mt-0.5 text-[11px] text-text-faint">
                {t(`settings.routing.${m}.sub` as MessageKey)}
              </div>
            </button>
          ))}
        </div>
        <Toggle
          label={t("settings.quic.label")}
          hint={t("settings.quic.hint")}
          checked={proxy.blockQuic}
          onChange={(v) => setProxy({ blockQuic: v })}
        />
      </Section>

      <Section title={t("settings.rules.title")}>
        <p className="-mt-1 text-[11px] text-text-faint">{t("settings.rules.intro")}</p>
        {proxy.customRules.length === 0 && (
          <div className="rounded-btn border border-dashed border-border px-3 py-3 text-center text-xs text-text-faint">
            {t("settings.rules.empty")}
          </div>
        )}
        {proxy.customRules.map((rule, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <select
              className="ns-input w-32 shrink-0"
              value={rule.match}
              onChange={(e) => updateRule(idx, { match: e.target.value as RoutingRuleMatch })}
            >
              {MATCH_KEYS.map((m) => (
                <option key={m} value={m}>
                  {t(`settings.match.${m}` as MessageKey)}
                </option>
              ))}
            </select>
            <input
              className="ns-input flex-1 font-mono"
              placeholder={MATCH_PLACEHOLDER[rule.match]}
              value={rule.value}
              onChange={(e) => updateRule(idx, { value: e.target.value })}
            />
            <select
              className="ns-input w-28 shrink-0"
              value={rule.target}
              onChange={(e) => updateRule(idx, { target: e.target.value as RoutingTarget })}
            >
              {TARGET_KEYS.map((tk) => (
                <option key={tk} value={tk}>
                  {t(`settings.target.${tk}` as MessageKey)}
                </option>
              ))}
            </select>
            <button
              onClick={() => removeRule(idx)}
              title={t("settings.rules.remove")}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-btn text-text-faint transition-colors hover:bg-surface hover:text-bad"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        <button
          onClick={addRule}
          className="flex items-center gap-1.5 rounded-btn border border-border px-3 py-2 text-sm text-text-dim transition-colors hover:border-indigo/40 hover:text-text"
        >
          <Plus size={15} /> {t("settings.rules.add")}
        </button>
      </Section>

      <Section title={t("settings.tun.title")}>
        {proxy.tun.enabled && !elevated && (
          <div className="flex items-center justify-between gap-3 rounded-btn bg-indigo/10 px-3 py-2.5">
            <div className="flex items-center gap-2 text-xs text-indigo">
              <ShieldAlert size={16} /> {t("settings.tun.needAdmin")}
            </div>
            <button
              onClick={() => relaunchAsAdmin()}
              className="shrink-0 rounded-btn bg-indigo px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-soft"
            >
              {t("settings.tun.relaunch")}
            </button>
          </div>
        )}
        {proxy.tun.enabled && elevated && (
          <div className="flex items-center gap-2 rounded-btn bg-ok/10 px-3 py-2 text-xs text-ok">
            <ShieldCheck size={16} /> {t("settings.tun.adminOk")}
          </div>
        )}
        <Toggle
          label={t("settings.tun.enable")}
          hint={t("settings.tun.enableHint")}
          checked={proxy.tun.enabled}
          onChange={(v) => setProxy({ tun: { ...proxy.tun, enabled: v } })}
        />
        <Row label={t("settings.tun.stack")}>
          <select
            className="ns-input w-40"
            value={proxy.tun.stack}
            onChange={(e) =>
              setProxy({ tun: { ...proxy.tun, stack: e.target.value as typeof proxy.tun.stack } })
            }
          >
            <option value="system">system</option>
            <option value="gvisor">gVisor</option>
            <option value="mixed">mixed</option>
          </select>
        </Row>
        <Toggle
          label={t("settings.fakeip.label")}
          hint={t("settings.fakeip.hint")}
          checked={proxy.fakeIp}
          onChange={(v) => setProxy({ fakeIp: v })}
        />
        <Row label={t("settings.dns.proxy")}>
          <input
            className="ns-input font-mono"
            value={proxy.dns.remote}
            onChange={(e) => setProxy({ dns: { ...proxy.dns, remote: e.target.value } })}
          />
        </Row>
        <Row label={t("settings.dns.direct")}>
          <input
            className="ns-input font-mono"
            value={proxy.dns.direct}
            onChange={(e) => setProxy({ dns: { ...proxy.dns, direct: e.target.value } })}
          />
        </Row>
      </Section>

      <Section title={t("settings.localProxy.title")}>
        <Row label={t("settings.mixedPort")}>
          <input
            type="number"
            className="ns-input w-32 font-mono"
            value={proxy.mixedPort}
            onChange={(e) => setProxy({ mixedPort: Number(e.target.value) })}
          />
        </Row>
        <Toggle
          label={t("settings.systemProxy.label")}
          hint={t("settings.systemProxy.hint")}
          checked={proxy.systemProxy}
          onChange={(v) => setProxy({ systemProxy: v })}
        />
        <Toggle
          label={t("settings.allowLan")}
          checked={proxy.allowLan}
          onChange={(v) => setProxy({ allowLan: v })}
        />
        <Toggle
          label={t("settings.mux.label")}
          hint={t("settings.mux.hint", { protocol: proxy.mux.protocol })}
          checked={proxy.mux.enabled}
          onChange={(v) => setProxy({ mux: { ...proxy.mux, enabled: v } })}
        />
        <Toggle
          label={t("settings.fragment.label")}
          hint={t("settings.fragment.hint")}
          checked={proxy.fragment.enabled}
          onChange={(v) => setProxy({ fragment: { ...proxy.fragment, enabled: v } })}
        />
      </Section>

      <Section title={t("settings.clash.title")}>
        <Row label={t("settings.clash.port")}>
          <input
            type="number"
            className="ns-input w-32 font-mono"
            value={proxy.clashApiPort}
            onChange={(e) => setProxy({ clashApiPort: Number(e.target.value) })}
          />
        </Row>
        <Row label={t("settings.clash.secret")}>
          <input
            className="ns-input font-mono"
            value={proxy.clashSecret}
            onChange={(e) => setProxy({ clashSecret: e.target.value })}
          />
        </Row>
      </Section>

      <Section title={t("settings.subs.title")}>
        <SubscriptionList />
      </Section>

      <Section title={t("settings.app.title")}>
        <Row label={t("settings.app.theme")}>
          <select
            className="ns-input w-40"
            value={app.theme}
            onChange={(e) => setApp({ theme: e.target.value as typeof app.theme })}
          >
            <option value="system">{t("settings.theme.system")}</option>
            <option value="dark">{t("settings.theme.dark")}</option>
            <option value="light">{t("settings.theme.light")}</option>
          </select>
        </Row>
        <Row label={t("settings.app.language")}>
          <select
            className="ns-input w-40"
            value={app.language}
            onChange={(e) => setApp({ language: e.target.value as typeof app.language })}
          >
            <option value="ru">Русский</option>
            <option value="en">English</option>
            <option value="fa">فارسی</option>
            <option value="zh">中文</option>
          </select>
        </Row>
        <Toggle
          label={t("settings.app.autoStart")}
          checked={app.autoStart}
          onChange={(v) => setApp({ autoStart: v })}
        />
        <Toggle
          label={t("settings.app.minimizeToTray")}
          checked={app.minimizeToTray}
          onChange={(v) => setApp({ minimizeToTray: v })}
        />
      </Section>

      <div className="flex gap-2">
        <button
          onClick={() => openLogsDir()}
          className="glass flex items-center gap-2 rounded-btn px-3 py-2 text-sm text-text-dim hover:text-text"
        >
          <Folder size={15} /> {t("settings.openLogs")}
        </button>
        <button
          onClick={reset}
          className="flex items-center gap-2 rounded-btn px-3 py-2 text-sm text-text-faint hover:text-bad"
        >
          <RotateCcw size={15} /> {t("settings.reset")}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass rounded-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-text">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-text-dim">{label}</span>
      {children}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm text-text-dim">{label}</div>
        {hint && <div className="text-[11px] text-text-faint">{hint}</div>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-indigo" : "bg-surface",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
            checked ? "translate-x-[22px]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}
