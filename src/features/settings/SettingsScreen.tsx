import { useEffect, useState } from "react";
import { Folder, RotateCcw, ShieldAlert, ShieldCheck } from "lucide-react";
import { useSettingsStore } from "../../store/useSettingsStore";
import { openLogsDir, isElevated, relaunchAsAdmin } from "../../core/ipc";
import { cn } from "../../shared/lib/utils";
import type { RoutingMode, CoreKind } from "../../core/types";
import { SubscriptionList } from "./SubscriptionList";

export function SettingsScreen() {
  const { proxy, app, setProxy, setApp, reset } = useSettingsStore();
  const [elevated, setElevated] = useState(true);

  useEffect(() => {
    isElevated().then(setElevated);
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-5">
      <Section title="\u042f\u0434\u0440\u043e (\u0434\u0432\u0438\u0436\u043e\u043a)">
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
              <div className="font-medium">{CORE_LABEL[k].title}</div>
              <div className="mt-0.5 text-[11px] text-text-faint">{CORE_LABEL[k].sub}</div>
            </button>
          ))}
        </div>
      </Section>

      <Section title="\u0420\u0435\u0436\u0438\u043c \u043c\u0430\u0440\u0448\u0440\u0443\u0442\u0438\u0437\u0430\u0446\u0438\u0438">
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
              <div className="font-medium">{ROUTING_LABEL[m].title}</div>
              <div className="mt-0.5 text-[11px] text-text-faint">{ROUTING_LABEL[m].sub}</div>
            </button>
          ))}
        </div>
      </Section>

      <Section title="TUN-\u0440\u0435\u0436\u0438\u043c (\u0441\u0438\u0441\u0442\u0435\u043c\u043d\u044b\u0439 VPN)">
        {proxy.tun.enabled && !elevated && (
          <div className="flex items-center justify-between gap-3 rounded-btn bg-indigo/10 px-3 py-2.5">
            <div className="flex items-center gap-2 text-xs text-indigo">
              <ShieldAlert size={16} /> \u0414\u043b\u044f TUN \u043d\u0443\u0436\u043d\u044b \u043f\u0440\u0430\u0432\u0430 \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u0430
            </div>
            <button
              onClick={() => relaunchAsAdmin()}
              className="shrink-0 rounded-btn bg-indigo px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-soft"
            >
              \u041f\u0435\u0440\u0435\u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u0441 \u043f\u0440\u0430\u0432\u0430\u043c\u0438
            </button>
          </div>
        )}
        {proxy.tun.enabled && elevated && (
          <div className="flex items-center gap-2 rounded-btn bg-ok/10 px-3 py-2 text-xs text-ok">
            <ShieldCheck size={16} /> \u041f\u0440\u0430\u0432\u0430 \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u0430 \u043f\u043e\u043b\u0443\u0447\u0435\u043d\u044b
          </div>
        )}
        <Toggle
          label="\u0412\u043a\u043b\u044e\u0447\u0438\u0442\u044c TUN-\u0430\u0434\u0430\u043f\u0442\u0435\u0440"
          hint="\u041f\u0435\u0440\u0435\u0445\u0432\u0430\u0442 \u0432\u0441\u0435\u0433\u043e \u0442\u0440\u0430\u0444\u0438\u043a\u0430. \u0422\u0440\u0435\u0431\u0443\u0435\u0442 \u043f\u0440\u0430\u0432 \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u0430."
          checked={proxy.tun.enabled}
          onChange={(v) => setProxy({ tun: { ...proxy.tun, enabled: v } })}
        />
        <Row label="TUN stack">
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
          label="Fake-IP DNS"
          hint="\u0423\u0441\u043a\u043e\u0440\u044f\u0435\u0442 \u0440\u0435\u0437\u043e\u043b\u0432\u0438\u043d\u0433 \u0438 \u0441\u043d\u0438\u0436\u0430\u0435\u0442 \u0443\u0442\u0435\u0447\u043a\u0438 DNS."
          checked={proxy.fakeIp}
          onChange={(v) => setProxy({ fakeIp: v })}
        />
        <Row label="DNS (proxy)">
          <input
            className="ns-input font-mono"
            value={proxy.dns.remote}
            onChange={(e) => setProxy({ dns: { ...proxy.dns, remote: e.target.value } })}
          />
        </Row>
        <Row label="DNS (direct)">
          <input
            className="ns-input font-mono"
            value={proxy.dns.direct}
            onChange={(e) => setProxy({ dns: { ...proxy.dns, direct: e.target.value } })}
          />
        </Row>
      </Section>

      <Section title="\u041b\u043e\u043a\u0430\u043b\u044c\u043d\u044b\u0439 \u043f\u0440\u043e\u043a\u0441\u0438">
        <Row label="Mixed-\u043f\u043e\u0440\u0442 (HTTP+SOCKS)">
          <input
            type="number"
            className="ns-input w-32 font-mono"
            value={proxy.mixedPort}
            onChange={(e) => setProxy({ mixedPort: Number(e.target.value) })}
          />
        </Row>
        <Toggle
          label="\u0421\u0438\u0441\u0442\u0435\u043c\u043d\u044b\u0439 \u043f\u0440\u043e\u043a\u0441\u0438"
          hint="\u0410\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438 \u043f\u0440\u043e\u043f\u0438\u0441\u044b\u0432\u0430\u0442\u044c \u043f\u0440\u043e\u043a\u0441\u0438 \u0432 \u0441\u0438\u0441\u0442\u0435\u043c\u0435 \u043f\u0440\u0438 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0438."
          checked={proxy.systemProxy}
          onChange={(v) => setProxy({ systemProxy: v })}
        />
        <Toggle
          label="\u0420\u0430\u0437\u0440\u0435\u0448\u0438\u0442\u044c \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u044f \u0438\u0437 LAN"
          checked={proxy.allowLan}
          onChange={(v) => setProxy({ allowLan: v })}
        />
        <Toggle
          label="Mux (\u043c\u0443\u043b\u044c\u0442\u0438\u043f\u043b\u0435\u043a\u0441\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435)"
          hint={`\u041f\u0440\u043e\u0442\u043e\u043a\u043e\u043b: ${proxy.mux.protocol}`}
          checked={proxy.mux.enabled}
          onChange={(v) => setProxy({ mux: { ...proxy.mux, enabled: v } })}
        />
        <Toggle
          label="Fragment (\u043e\u0431\u0445\u043e\u0434 DPI)"
          hint="\u0424\u0440\u0430\u0433\u043c\u0435\u043d\u0442\u0430\u0446\u0438\u044f TLS ClientHello."
          checked={proxy.fragment.enabled}
          onChange={(v) => setProxy({ fragment: { ...proxy.fragment, enabled: v } })}
        />
      </Section>

      <Section title="Clash API">
        <Row label="\u041f\u043e\u0440\u0442">
          <input
            type="number"
            className="ns-input w-32 font-mono"
            value={proxy.clashApiPort}
            onChange={(e) => setProxy({ clashApiPort: Number(e.target.value) })}
          />
        </Row>
        <Row label="Secret">
          <input
            className="ns-input font-mono"
            value={proxy.clashSecret}
            onChange={(e) => setProxy({ clashSecret: e.target.value })}
          />
        </Row>
      </Section>

      <Section title="\u041f\u043e\u0434\u043f\u0438\u0441\u043a\u0438">
        <SubscriptionList />
      </Section>

      <Section title="\u041f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435">
        <Row label="\u0422\u0435\u043c\u0430">
          <select
            className="ns-input w-40"
            value={app.theme}
            onChange={(e) => setApp({ theme: e.target.value as typeof app.theme })}
          >
            <option value="system">\u0421\u0438\u0441\u0442\u0435\u043c\u043d\u0430\u044f</option>
            <option value="dark">\u0422\u0451\u043c\u043d\u0430\u044f</option>
            <option value="light">\u0421\u0432\u0435\u0442\u043b\u0430\u044f</option>
          </select>
        </Row>
        <Row label="\u042f\u0437\u044b\u043a">
          <select
            className="ns-input w-40"
            value={app.language}
            onChange={(e) => setApp({ language: e.target.value as typeof app.language })}
          >
            <option value="ru">\u0420\u0443\u0441\u0441\u043a\u0438\u0439</option>
            <option value="en">English</option>
            <option value="fa">\u0641\u0627\u0631\u0633\u06cc</option>
            <option value="zh">\u4e2d\u6587</option>
          </select>
        </Row>
        <Toggle
          label="\u0410\u0432\u0442\u043e\u0437\u0430\u043f\u0443\u0441\u043a \u043f\u0440\u0438 \u0441\u0442\u0430\u0440\u0442\u0435 \u0441\u0438\u0441\u0442\u0435\u043c\u044b"
          checked={app.autoStart}
          onChange={(v) => setApp({ autoStart: v })}
        />
        <Toggle
          label="\u0421\u0432\u043e\u0440\u0430\u0447\u0438\u0432\u0430\u0442\u044c \u0432 \u0442\u0440\u0435\u0439"
          checked={app.minimizeToTray}
          onChange={(v) => setApp({ minimizeToTray: v })}
        />
      </Section>

      <div className="flex gap-2">
        <button
          onClick={() => openLogsDir()}
          className="glass flex items-center gap-2 rounded-btn px-3 py-2 text-sm text-text-dim hover:text-text"
        >
          <Folder size={15} /> \u041e\u0442\u043a\u0440\u044b\u0442\u044c \u043f\u0430\u043f\u043a\u0443 \u043b\u043e\u0433\u043e\u0432
        </button>
        <button
          onClick={reset}
          className="flex items-center gap-2 rounded-btn px-3 py-2 text-sm text-text-faint hover:text-bad"
        >
          <RotateCcw size={15} /> \u0421\u0431\u0440\u043e\u0441\u0438\u0442\u044c \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438
        </button>
      </div>
    </div>
  );
}

const CORE_LABEL: Record<CoreKind, { title: string; sub: string }> = {
  "sing-box": { title: "sing-box", sub: "\u0443\u043d\u0438\u0432\u0435\u0440\u0441\u0430\u043b\u044c\u043d\u043e\u0435" },
  xray: { title: "Xray-core", sub: "VLESS / Reality" },
};

const ROUTING_LABEL: Record<RoutingMode, { title: string; sub: string }> = {
  global: { title: "Global", sub: "\u0432\u0435\u0441\u044c \u0442\u0440\u0430\u0444\u0438\u043a" },
  rule: { title: "Rule-based", sub: "\u043f\u043e \u043f\u0440\u0430\u0432\u0438\u043b\u0430\u043c" },
  direct: { title: "Direct", sub: "\u043d\u0430\u043f\u0440\u044f\u043c\u0443\u044e" },
};

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
