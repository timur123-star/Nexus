import { useEffect, useState } from "react";
import { AppWindow, Folder, Plus, RotateCcw, Route, Save, ShieldAlert, ShieldCheck, Trash2, X } from "lucide-react";
import { useSettingsStore } from "../../store/useSettingsStore";
import { openLogsDir, isElevated, relaunchAsAdmin } from "../../core/ipc";
import { cn } from "../../shared/lib/utils";
import { ACCENTS } from "../../shared/lib/accents";
import { useT } from "../../core/i18n/useT";
import type { Lang, MessageKey } from "../../core/i18n";
import type { CoreKind, RoutingMode, RoutingProfile, RoutingRuleMatch, RoutingTarget } from "../../core/types";
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

// Localised label for the accent picker. Inline so messages.ts (and its i18n
// parity test) stays untouched.
const ACCENT_LABEL: Record<Lang, string> = {
  en: "Accent color",
  ru: "Акцентный цвет",
  fa: "رنگ تأکیدی",
  zh: "强调色",
};

// Localised strings for the routing-profiles block. Kept inline (rather than in
// the global dictionary) so the feature stays self-contained; ru/en are fully
// covered and fa/zh gracefully fall back to English-style values.
const PROFILE_STRINGS: Record<Lang, Record<string, string>> = {
  en: {
    title: "Routing profiles",
    intro: "Save the routing mode, custom rules and QUIC switch as a profile and switch between them in one click.",
    smart: "Smart (rules)",
    global: "Global",
    direct: "Direct",
    save: "Save current as profile",
    namePlaceholder: "Profile name",
    defaultName: "Profile",
    delete: "Delete profile",
    apply: "Apply profile",
  },
  ru: {
    title: "Профили маршрутизации",
    intro: "Сохраните режим маршрутизации, свои правила и переключатель QUIC как профиль и меняйте их одним кликом.",
    smart: "Умный (по правилам)",
    global: "Глобальный",
    direct: "Прямой",
    save: "Сохранить текущие как профиль",
    namePlaceholder: "Название профиля",
    defaultName: "Профиль",
    delete: "Удалить профиль",
    apply: "Применить профиль",
  },
  fa: {
    title: "پروفایل‌های مسیریابی",
    intro: "حالت مسیریابی، قوانین سفارشی و QUIC را به‌عنوان پروفایل ذخیره کنید و با یک کلیک جابه‌جا شوید.",
    smart: "هوشمند (قوانین)",
    global: "سراسری",
    direct: "مستقیم",
    save: "ذخیره به‌عنوان پروفایل",
    namePlaceholder: "نام پروفایل",
    defaultName: "پروفایل",
    delete: "حذف پروفایل",
    apply: "اعمال پروفایل",
  },
  zh: {
    title: "路由配置",
    intro: "将路由模式、自定义规则和 QUIC 开关保存为配置，一键切换。",
    smart: "智能（规则）",
    global: "全局",
    direct: "直连",
    save: "保存为配置",
    namePlaceholder: "配置名称",
    defaultName: "配置",
    delete: "删除配置",
    apply: "应用配置",
  },
};

// App presets for split tunnelling. Each entry maps to the common process names
// across Windows/macOS/Linux; toggling adds/removes process_name rules.
const APP_PRESETS: Array<{ id: string; label: string; processes: string[] }> = [
  { id: "telegram", label: "Telegram", processes: ["Telegram.exe", "telegram", "Telegram"] },
  { id: "discord", label: "Discord", processes: ["Discord.exe", "Discord"] },
  { id: "chrome", label: "Chrome", processes: ["chrome.exe", "Google Chrome"] },
  { id: "firefox", label: "Firefox", processes: ["firefox.exe", "firefox"] },
  { id: "edge", label: "Edge", processes: ["msedge.exe", "Microsoft Edge"] },
  { id: "steam", label: "Steam", processes: ["steam.exe", "steam", "steam_osx"] },
  { id: "spotify", label: "Spotify", processes: ["Spotify.exe", "Spotify"] },
  { id: "whatsapp", label: "WhatsApp", processes: ["WhatsApp.exe", "WhatsApp"] },
  { id: "qbittorrent", label: "qBittorrent", processes: ["qbittorrent.exe", "qbittorrent"] },
];

const APP_STRINGS: Record<Lang, { title: string; intro: string; routeVia: string }> = {
  en: {
    title: "Per-app proxy (split tunneling)",
    intro: "Pick apps to route through the chosen outbound. Adds process-name rules to the list above. Works best in TUN mode.",
    routeVia: "Route selected apps via",
  },
  ru: {
    title: "Раздельный прокси по приложениям",
    intro: "Выберите приложения, чей трафик пойдёт через выбранный выход. Добавляет правила по имени процесса в список выше. Лучше всего работает в TUN-режиме.",
    routeVia: "Выбранные приложения — через",
  },
  fa: {
    title: "پروکسی بر اساس برنامه",
    intro: "برنامه‌هایی را انتخاب کنید که از خروجی انتخابی عبور کنند. در حالت TUN بهتر کار می‌کند.",
    routeVia: "ارسال برنامه‌های انتخابی از طریق",
  },
  zh: {
    title: "应用分流",
    intro: "选择要经由所选出口的应用。会向上方列表添加进程名规则。在 TUN 模式下效果最佳。",
    routeVia: "选定应用经由",
  },
};

function sameRules(a: RoutingProfile["customRules"], b: RoutingProfile["customRules"]): boolean {
  if (a.length !== b.length) return false;
  return a.every((r, i) => r.match === b[i].match && r.value === b[i].value && r.target === b[i].target);
}

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

      <RoutingProfiles />

      <PerAppProxy />

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
        <Row label={ACCENT_LABEL[app.language] ?? ACCENT_LABEL.en}>
          <div className="flex gap-1.5">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setApp({ accent: a.id })}
                title={a.id}
                aria-label={a.id}
                className={cn(
                  "h-6 w-6 rounded-full transition-transform",
                  app.accent === a.id
                    ? "ring-2 ring-text/70 ring-offset-2 ring-offset-bg scale-110"
                    : "hover:scale-110",
                )}
                style= backgroundColor: a.base 
              />
            ))}
          </div>
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

function RoutingProfiles() {
  const proxy = useSettingsStore((s) => s.proxy);
  const setProxy = useSettingsStore((s) => s.setProxy);
  const lang = useSettingsStore((s) => s.app.language);
  const ps = PROFILE_STRINGS[lang] ?? PROFILE_STRINGS.en;
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState("");

  const customCount = proxy.routingProfiles.filter((p) => !p.builtin).length;

  const profileLabel = (p: RoutingProfile): string =>
    p.builtin ? ps[p.nameKey ?? ""] ?? p.nameKey ?? "?" : p.name || "?";

  const isActive = (p: RoutingProfile): boolean =>
    p.routingMode === proxy.routingMode &&
    p.blockQuic === proxy.blockQuic &&
    sameRules(p.customRules, proxy.customRules);

  const applyProfile = (p: RoutingProfile) =>
    setProxy({
      routingMode: p.routingMode,
      blockQuic: p.blockQuic,
      customRules: p.customRules.map((r) => ({ ...r })),
    });

  const removeProfile = (id: string) =>
    setProxy({ routingProfiles: proxy.routingProfiles.filter((p) => p.id !== id) });

  const startNaming = () => {
    setDraft(`${ps.defaultName} ${customCount + 1}`);
    setNaming(true);
  };

  const confirmSave = () => {
    const name = draft.trim() || `${ps.defaultName} ${customCount + 1}`;
    const profile: RoutingProfile = {
      id: `prof-${Date.now()}`,
      name,
      routingMode: proxy.routingMode,
      blockQuic: proxy.blockQuic,
      customRules: proxy.customRules.map((r) => ({ ...r })),
    };
    setProxy({ routingProfiles: [...proxy.routingProfiles, profile] });
    setNaming(false);
    setDraft("");
  };

  return (
    <Section title={ps.title}>
      <p className="-mt-1 text-[11px] text-text-faint">{ps.intro}</p>
      <div className="flex flex-wrap gap-2">
        {proxy.routingProfiles.map((p) => {
          const active = isActive(p);
          return (
            <div
              key={p.id}
              className={cn(
                "flex items-center gap-1.5 rounded-btn border px-3 py-1.5 text-sm transition-colors",
                active
                  ? "border-indigo bg-indigo/10 text-indigo"
                  : "border-border text-text-dim hover:text-text",
              )}
            >
              <button
                type="button"
                onClick={() => applyProfile(p)}
                title={ps.apply}
                className="flex items-center gap-1.5"
              >
                <Route size={14} />
                <span>{profileLabel(p)}</span>
              </button>
              {!p.builtin && (
                <button
                  type="button"
                  onClick={() => removeProfile(p.id)}
                  title={ps.delete}
                  className="grid h-4 w-4 place-items-center rounded text-text-faint transition-colors hover:text-bad"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {naming ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            className="ns-input flex-1"
            placeholder={ps.namePlaceholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmSave();
              else if (e.key === "Escape") setNaming(false);
            }}
          />
          <button
            type="button"
            onClick={confirmSave}
            title={ps.save}
            className="flex shrink-0 items-center gap-1.5 rounded-btn bg-indigo px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-soft"
          >
            <Save size={15} />
          </button>
          <button
            type="button"
            onClick={() => setNaming(false)}
            className="shrink-0 rounded-btn px-3 py-2 text-sm text-text-faint transition-colors hover:text-text"
          >
            <X size={15} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={startNaming}
          className="flex items-center gap-1.5 rounded-btn border border-border px-3 py-2 text-sm text-text-dim transition-colors hover:border-indigo/40 hover:text-text"
        >
          <Save size={15} /> {ps.save}
        </button>
      )}
    </Section>
  );
}

function PerAppProxy() {
  const proxy = useSettingsStore((s) => s.proxy);
  const setProxy = useSettingsStore((s) => s.setProxy);
  const lang = useSettingsStore((s) => s.app.language);
  const aps = APP_STRINGS[lang] ?? APP_STRINGS.en;
  const t = useT();
  const [target, setTarget] = useState<RoutingTarget>("proxy");

  const appActive = (processes: string[]): boolean =>
    processes.some((pn) =>
      proxy.customRules.some((r) => r.match === "process_name" && r.value === pn),
    );

  const toggleApp = (processes: string[]) => {
    if (appActive(processes)) {
      setProxy({
        customRules: proxy.customRules.filter(
          (r) => !(r.match === "process_name" && processes.includes(r.value)),
        ),
      });
      return;
    }
    const present = new Set(
      proxy.customRules.filter((r) => r.match === "process_name").map((r) => r.value),
    );
    const additions = processes
      .filter((pn) => !present.has(pn))
      .map((pn) => ({ match: "process_name" as RoutingRuleMatch, value: pn, target }));
    setProxy({ customRules: [...proxy.customRules, ...additions] });
  };

  return (
    <Section title={aps.title}>
      <p className="-mt-1 text-[11px] text-text-faint">{aps.intro}</p>
      <Row label={aps.routeVia}>
        <select
          className="ns-input w-40"
          value={target}
          onChange={(e) => setTarget(e.target.value as RoutingTarget)}
        >
          {TARGET_KEYS.map((tk) => (
            <option key={tk} value={tk}>
              {t(`settings.target.${tk}` as MessageKey)}
            </option>
          ))}
        </select>
      </Row>
      <div className="flex flex-wrap gap-2">
        {APP_PRESETS.map((preset) => {
          const active = appActive(preset.processes);
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => toggleApp(preset.processes)}
              className={cn(
                "flex items-center gap-1.5 rounded-btn border px-3 py-1.5 text-sm transition-colors",
                active
                  ? "border-indigo bg-indigo/10 text-indigo"
                  : "border-border text-text-dim hover:text-text",
              )}
            >
              <AppWindow size={14} />
              <span>{preset.label}</span>
            </button>
          );
        })}
      </div>
    </Section>
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
      <div className="min-w-0">
        <div className="text-sm text-text-dim">{label}</div>
        {hint && <div className="text-[11px] text-text-faint">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors duration-200",
          checked ? "bg-indigo" : "bg-surface",
        )}
      >
        <span
          className={cn(
            "h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out",
            checked ? "translate-x-5" : "translate-x-0",
          )}
        />
      </button>
    </div>
  );
}
