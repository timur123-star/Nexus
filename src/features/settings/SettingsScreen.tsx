import { useEffect, useState } from "react";
import { Folder, Plus, RotateCcw, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { useSettingsStore } from "../../store/useSettingsStore";
import { openLogsDir, isElevated, relaunchAsAdmin } from "../../core/ipc";
import { cn } from "../../shared/lib/utils";
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

const MATCH_LABEL: Record<RoutingRuleMatch, string> = {
  domain: "Домен",
  domain_suffix: "Суффикс",
  domain_keyword: "Ключ. слово",
  ip_cidr: "IP / CIDR",
  process_name: "Процесс",
};
const TARGET_LABEL: Record<RoutingTarget, string> = {
  proxy: "Прокси",
  direct: "Напрямую",
  block: "Блок",
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
        <Toggle
          label="Блокировать QUIC (HTTP/3)"
          hint="Заставляет браузеры использовать TCP/TLS, чтобы трафик не утекал мимо правил."
          checked={proxy.blockQuic}
          onChange={(v) => setProxy({ blockQuic: v })}
        />
      </Section>

      <Section title="Свои правила маршрутизации">
        <p className="-mt-1 text-[11px] text-text-faint">
          Применяются раньше встроенных geo-правил и имеют приоритет. Пустые строки игнорируются.
        </p>
        {proxy.customRules.length === 0 && (
          <div className="rounded-btn border border-dashed border-border px-3 py-3 text-center text-xs text-text-faint">
            Пока нет правил — добавьте первое ниже.
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
                  {MATCH_LABEL[m]}
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
              {TARGET_KEYS.map((t) => (
                <option key={t} value={t}>
                  {TARGET_LABEL[t]}
                </option>
              ))}
            </select>
            <button
              onClick={() => removeRule(idx)}
              title="Удалить правило"
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
          <Plus size={15} /> Добавить правило
        </button>
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
