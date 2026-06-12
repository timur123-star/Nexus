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
      <Section title="Ядро (движок)">
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

      <Section title="Режим маршрутизации">
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

      <Section title="TUN-режим (системный VPN)">
        {proxy.tun.enabled && !elevated && (
          <div className="flex items-center justify-between gap-3 rounded-btn bg-indigo/10 px-3 py-2.5">
            <div className="flex items-center gap-2 text-xs text-indigo">
              <ShieldAlert size={16} /> Для TUN нужны права администратора
            </div>
            <button
              onClick={() => relaunchAsAdmin()}
              className="shrink-0 rounded-btn bg-indigo px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-soft"
            >
              Перезапустить с правами
            </button>
          </div>
        )}
        {proxy.tun.enabled && elevated && (
          <div className="flex items-center gap-2 rounded-btn bg-ok/10 px-3 py-2 text-xs text-ok">
            <ShieldCheck size={16} /> Права администратора получены
          </div>
        )}
        <Toggle
          label="Включить TUN-адаптер"
          hint="Перехват всего трафика. Требует прав администратора."
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
          hint="Ускоряет резолвинг и снижает утечки DNS."
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

      <Section title="Локальный прокси">
        <Row label="Mixed-порт (HTTP+SOCKS)">
          <input
            type="number"
            className="ns-input w-32 font-mono"
            value={proxy.mixedPort}
            onChange={(e) => setProxy({ mixedPort: Number(e.target.value) })}
          />
        </Row>
        <Toggle
          label="Системный прокси"
          hint="Автоматически прописывать прокси в системе при подключении."
          checked={proxy.systemProxy}
          onChange={(v) => setProxy({ systemProxy: v })}
        />
        <Toggle
          label="Разрешить подключения из LAN"
          checked={proxy.allowLan}
          onChange={(v) => setProxy({ allowLan: v })}
        />
        <Toggle
          label="Mux (мультиплексирование)"
          hint={`Протокол: ${proxy.mux.protocol}`}
          checked={proxy.mux.enabled}
          onChange={(v) => setProxy({ mux: { ...proxy.mux, enabled: v } })}
        />
        <Toggle
          label="Fragment (обход DPI)"
          hint="Фрагментация TLS ClientHello."
          checked={proxy.fragment.enabled}
          onChange={(v) => setProxy({ fragment: { ...proxy.fragment, enabled: v } })}
        />
      </Section>

      <Section title="Clash API">
        <Row label="Порт">
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

      <Section title="Подписки">
        <SubscriptionList />
      </Section>

      <Section title="Приложение">
        <Row label="Тема">
          <select
            className="ns-input w-40"
            value={app.theme}
            onChange={(e) => setApp({ theme: e.target.value as typeof app.theme })}
          >
            <option value="system">Системная</option>
            <option value="dark">Тёмная</option>
            <option value="light">Светлая</option>
          </select>
        </Row>
        <Row label="Язык">
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
          label="Автозапуск при старте системы"
          checked={app.autoStart}
          onChange={(v) => setApp({ autoStart: v })}
        />
        <Toggle
          label="Сворачивать в трей"
          checked={app.minimizeToTray}
          onChange={(v) => setApp({ minimizeToTray: v })}
        />
      </Section>

      <div className="flex gap-2">
        <button
          onClick={() => openLogsDir()}
          className="glass flex items-center gap-2 rounded-btn px-3 py-2 text-sm text-text-dim hover:text-text"
        >
          <Folder size={15} /> Открыть папку логов
        </button>
        <button
          onClick={reset}
          className="flex items-center gap-2 rounded-btn px-3 py-2 text-sm text-text-faint hover:text-bad"
        >
          <RotateCcw size={15} /> Сбросить настройки
        </button>
      </div>
    </div>
  );
}

const CORE_LABEL: Record<CoreKind, { title: string; sub: string }> = {
  "sing-box": { title: "sing-box", sub: "универсальное" },
  xray: { title: "Xray-core", sub: "VLESS / Reality" },
};

const ROUTING_LABEL: Record<RoutingMode, { title: string; sub: string }> = {
  global: { title: "Global", sub: "весь трафик" },
  rule: { title: "Rule-based", sub: "по правилам" },
  direct: { title: "Direct", sub: "напрямую" },
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
