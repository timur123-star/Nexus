import { useEffect, useState } from "react";
import { AppWindow, Boxes, Cloud, Folder, Globe, Navigation, Plus, RotateCcw, Route, Save, ShieldAlert, ShieldCheck, Trash2, X } from "lucide-react";
import { useSettingsStore } from "../../store/useSettingsStore";
import { useServerStore } from "../../store/useServerStore";
import { openLogsDir, isElevated, relaunchAsAdmin } from "../../core/ipc";
import { registerWarp } from "../../core/warp";
import { toast } from "../../store/useToastStore";
import { cn } from "../../shared/lib/utils";
import { CustomSelect } from "../../shared/components/CustomSelect";
import { ACCENTS } from "../../shared/lib/accents";
import { useT } from "../../core/i18n/useT";
import type { Lang, MessageKey } from "../../core/i18n";
import type { CoreKind, RoutingMode, RoutingProfile, RoutingRuleMatch, RoutingTarget } from "../../core/types";
import { SubscriptionList } from "./SubscriptionList";
import { BackupSection } from "./BackupSection";
import { UpdateSection } from "./UpdateSection";

const MATCH_KEYS: RoutingRuleMatch[] = [
  "domain",
  "domain_suffix",
  "domain_keyword",
  "domain_regex",
  "ip_cidr",
  "geoip",
  "geosite",
  "port",
  "process_name",
];
const TARGET_KEYS: RoutingTarget[] = ["proxy", "direct", "block"];

const CORE_TITLE: Record<CoreKind, string> = {
  "sing-box": "sing-box",
  xray: "Xray-core",
};

const ROUTE_ICON: Record<RoutingMode, React.ElementType> = {
  global: Globe,
  rule: ShieldCheck,
  direct: Navigation,
};

const MATCH_PLACEHOLDER: Record<RoutingRuleMatch, string> = {
  domain: "example.com",
  domain_suffix: ".openai.com",
  domain_keyword: "google",
  domain_regex: "^.*\\.openai\\.com$",
  ip_cidr: "10.0.0.0/8",
  geoip: "ir",
  geosite: "telegram",
  port: "443",
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

// Inline labels for the advanced transport tweaks (fragment / mux) and the
// subscription User-Agent, kept out of the global i18n dictionary so its strict
// key-parity test stays untouched. ru/en fully covered, fa/zh provided.
const ADV_STRINGS: Record<
  Lang,
  {
    muxProtocol: string;
    fragPackets: string;
    fragLength: string;
    fragInterval: string;
    subUa: string;
    subUaHint: string;
  }
> = {
  en: {
    muxProtocol: "Mux protocol",
    fragPackets: "Fragment packets",
    fragLength: "Fragment size",
    fragInterval: "Fragment interval (ms)",
    subUa: "Subscription User-Agent",
    subUaHint: "Sent when fetching subscriptions. Many panels (Hiddify, Marzban) return different content per client.",
  },
  ru: {
    muxProtocol: "Протокол Mux",
    fragPackets: "Пакеты фрагментации",
    fragLength: "Размер фрагмента",
    fragInterval: "Интервал фрагментации (мс)",
    subUa: "User-Agent для подписок",
    subUaHint: "Отправляется при загрузке подписок. Многие панели (Hiddify, Marzban) отдают разный контент в зависимости от клиента.",
  },
  fa: {
    muxProtocol: "پروتکل Mux",
    fragPackets: "بسته‌های فرگمنت",
    fragLength: "اندازه فرگمنت",
    fragInterval: "فاصله فرگمنت (ms)",
    subUa: "User-Agent اشتراک",
    subUaHint: "هنگام دریافت اشتراک ارسال می‌شود. بسیاری از پنل‌ها (Hiddify, Marzban) محتوای متفاوتی بازمی‌گردانند.",
  },
  zh: {
    muxProtocol: "Mux 协议",
    fragPackets: "分片数据包",
    fragLength: "分片大小",
    fragInterval: "分片间隔 (ms)",
    subUa: "订阅 User-Agent",
    subUaHint: "获取订阅时发送。许多面板（Hiddify、Marzban）会根据客户端返回不同内容。",
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
  const adv = ADV_STRINGS[app.language] ?? ADV_STRINGS.en;

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
        <div className="grid grid-cols-2 gap-2.5">
          {(["sing-box", "xray"] as CoreKind[]).map((k) => (
            <OptionCard
              key={k}
              icon={Boxes}
              title={CORE_TITLE[k]}
              sub={t(k === "sing-box" ? "settings.core.singbox.sub" : "settings.core.xray.sub")}
              selected={proxy.coreKind === k}
              onClick={() => setProxy({ coreKind: k })}
            />
          ))}
        </div>
      </Section>

      <Section title={t("settings.routing.title")}>
        <div className="grid grid-cols-3 gap-2.5">
          {(["global", "rule", "direct"] as RoutingMode[]).map((m) => (
            <OptionCard
              key={m}
              icon={ROUTE_ICON[m]}
              title={t(`settings.routing.${m}.title` as MessageKey)}
              sub={t(`settings.routing.${m}.sub` as MessageKey)}
              selected={proxy.routingMode === m}
              onClick={() => setProxy({ routingMode: m })}
            />
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
            <CustomSelect
              className="w-32 shrink-0"
              value={rule.match}
              options={MATCH_KEYS.map((m) => ({ value: m, label: t(`settings.match.${m}` as MessageKey) }))}
              onChange={(v) => updateRule(idx, { match: v as RoutingRuleMatch })}
            />
            <input
              className="ns-input flex-1 font-mono"
              placeholder={MATCH_PLACEHOLDER[rule.match]}
              value={rule.value}
              onChange={(e) => updateRule(idx, { value: e.target.value })}
            />
            <CustomSelect
              className="w-28 shrink-0"
              value={rule.target}
              options={TARGET_KEYS.map((tk) => ({ value: tk, label: t(`settings.target.${tk}` as MessageKey) }))}
              onChange={(v) => updateRule(idx, { target: v as RoutingTarget })}
            />
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
          <CustomSelect
            className="w-40"
            align="right"
            value={proxy.tun.stack}
            options={[
              { value: "system", label: "system" },
              { value: "gvisor", label: "gVisor" },
              { value: "mixed", label: "mixed" },
            ]}
            onChange={(v) => setProxy({ tun: { ...proxy.tun, stack: v as typeof proxy.tun.stack } })}
          />
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
        {proxy.mux.enabled && (
          <Row label={adv.muxProtocol}>
            <CustomSelect
              className="w-40"
              align="right"
              value={proxy.mux.protocol}
              options={[
                { value: "smux", label: "smux" },
                { value: "yamux", label: "yamux" },
                { value: "h2mux", label: "h2mux" },
              ]}
              onChange={(v) => setProxy({ mux: { ...proxy.mux, protocol: v as typeof proxy.mux.protocol } })}
            />
          </Row>
        )}
        <Toggle
          label={t("settings.fragment.label")}
          hint={t("settings.fragment.hint")}
          checked={proxy.fragment.enabled}
          onChange={(v) => setProxy({ fragment: { ...proxy.fragment, enabled: v } })}
        />
        {proxy.fragment.enabled && (
          <>
            <Row label={adv.fragPackets}>
              <input
                className="ns-input w-40 font-mono"
                placeholder="tlshello"
                value={proxy.fragment.packets}
                onChange={(e) => setProxy({ fragment: { ...proxy.fragment, packets: e.target.value } })}
              />
            </Row>
            <Row label={adv.fragLength}>
              <input
                className="ns-input w-40 font-mono"
                placeholder="10-20"
                value={proxy.fragment.length}
                onChange={(e) => setProxy({ fragment: { ...proxy.fragment, length: e.target.value } })}
              />
            </Row>
            <Row label={adv.fragInterval}>
              <input
                className="ns-input w-40 font-mono"
                placeholder="10-20"
                value={proxy.fragment.interval}
                onChange={(e) => setProxy({ fragment: { ...proxy.fragment, interval: e.target.value } })}
              />
            </Row>
          </>
        )}
      </Section>

      <Section title={t("settings.security.title")}>
        <Toggle
          label={t("settings.killSwitch.label")}
          hint={t("settings.killSwitch.hint")}
          checked={proxy.killSwitch}
          onChange={(v) => setProxy({ killSwitch: v })}
        />
        <Toggle
          label={t("settings.insecureSubs.label")}
          hint={t("settings.insecureSubs.hint")}
          checked={proxy.allowInsecureSubs}
          onChange={(v) => setProxy({ allowInsecureSubs: v })}
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
        <Row label={adv.subUa}>
          <input
            className="ns-input font-mono"
            placeholder="Hiddify/4.1.1"
            value={app.subscriptionUserAgent}
            onChange={(e) => setApp({ subscriptionUserAgent: e.target.value })}
          />
        </Row>
        <p className="-mt-1 text-[11px] text-text-faint">{adv.subUaHint}</p>
        <WarpButton lang={app.language} />
      </Section>

      <Section title={t("settings.app.title")}>
        <Row label={t("settings.app.theme")}>
          <CustomSelect
            className="w-40"
            align="right"
            value={app.theme}
            options={[
              { value: "system", label: t("settings.theme.system") },
              { value: "dark", label: t("settings.theme.dark") },
              { value: "light", label: t("settings.theme.light") },
              { value: "oled", label: "OLED" },
            ]}
            onChange={(v) => setApp({ theme: v as typeof app.theme })}
          />
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
                style={ { backgroundColor: a.base } }
              />
            ))}
          </div>
        </Row>
        <Row label={t("settings.app.language")}>
          <CustomSelect
            className="w-40"
            align="right"
            value={app.language}
            options={[
              { value: "ru", label: "Русский" },
              { value: "en", label: "English" },
              { value: "fa", label: "فارسی" },
              { value: "zh", label: "中文" },
            ]}
            onChange={(v) => setApp({ language: v as typeof app.language })}
          />
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
        <Toggle
          label={t("settings.app.autoSortByPing")}
          hint={t("settings.app.autoSortByPingHint")}
          checked={app.autoSortByPing}
          onChange={(v) => setApp({ autoSortByPing: v })}
        />
      </Section>

      <BackupSection />

      <UpdateSection />

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
        <CustomSelect
          className="w-40"
          align="right"
          value={target}
          options={TARGET_KEYS.map((tk) => ({ value: tk, label: t(`settings.target.${tk}` as MessageKey) }))}
          onChange={(v) => setTarget(v as RoutingTarget)}
        />
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

/** Custom radio-style selection card: left icon, title + subtitle, right radio dot. */
function OptionCard({
  icon: Icon,
  title,
  sub,
  selected,
  onClick,
}: {
  icon: React.ElementType;
  title: string;
  sub: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex items-center gap-3 rounded-card border px-3 py-3 text-left transition-colors",
        selected
          ? "border-indigo bg-indigo/10 shadow-[0_0_18px_rgba(220,38,38,0.18)]"
          : "border-border hover:border-indigo/40 hover:bg-surface/60",
      )}
    >
      <span
        className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-btn border transition-colors",
          selected
            ? "border-indigo/50 bg-indigo/15 text-indigo"
            : "border-border bg-bg-elev/40 text-text-faint group-hover:text-text-dim",
        )}
      >
        <Icon size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-sm font-semibold", selected ? "text-indigo" : "text-text")}>
          {title}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-text-faint">{sub}</div>
      </div>
      <span
        className={cn(
          "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border transition-colors",
          selected ? "border-indigo" : "border-border",
        )}
      >
        {selected && <span className="h-2.5 w-2.5 rounded-full bg-indigo" />}
      </span>
    </button>
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

// One-click Cloudflare WARP: registers a fresh WireGuard peer and imports it as
// a server. Strings are inline 4-language to keep the i18n parity test green.
const WARP_STRINGS: Record<
  Lang,
  { title: string; hint: string; button: string; working: string; ok: string; fail: string }
> = {
  en: {
    title: "Cloudflare WARP",
    hint: "Generate a free WARP (WireGuard) server in one click — no account needed.",
    button: "Add WARP",
    working: "Registering WARP…",
    ok: "WARP server added",
    fail: "Couldn't register WARP",
  },
  ru: {
    title: "Cloudflare WARP",
    hint: "Создайте бесплатный WARP-сервер (WireGuard) в один клик — без аккаунта.",
    button: "Добавить WARP",
    working: "Регистрирую WARP…",
    ok: "WARP-сервер добавлен",
    fail: "Не удалось зарегистрировать WARP",
  },
  fa: {
    title: "Cloudflare WARP",
    hint: "یک سرور رایگان WARP (WireGuard) با یک کلیک بسازید — بدون حساب کاربری.",
    button: "افزودن WARP",
    working: "در حال ثبت WARP…",
    ok: "سرور WARP اضافه شد",
    fail: "ثبت WARP ناموفق بود",
  },
  zh: {
    title: "Cloudflare WARP",
    hint: "一键生成免费的 WARP (WireGuard) 服务器 — 无需账户。",
    button: "添加 WARP",
    working: "正在注册 WARP…",
    ok: "已添加 WARP 服务器",
    fail: "WARP 注册失败",
  },
};

function WarpButton({ lang }: { lang: Lang }) {
  const W = WARP_STRINGS[lang] ?? WARP_STRINGS.en;
  const addFromBlob = useServerStore((s) => s.addFromBlob);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const link = await registerWarp();
      const { added } = addFromBlob(link);
      if (added > 0) toast.success(W.ok);
      else throw new Error("no server parsed");
    } catch (e) {
      toast.error(`${W.fail}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 rounded-btn border border-border/70 bg-bg/40 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm text-text">
            <Cloud size={14} className="shrink-0 text-indigo" /> {W.title}
          </div>
          <p className="mt-0.5 text-[11px] text-text-faint">{W.hint}</p>
        </div>
        <button
          onClick={run}
          disabled={busy}
          className={cn(
            "shrink-0 rounded-btn px-3 py-1.5 text-xs font-medium transition-colors",
            busy
              ? "cursor-wait bg-surface text-text-faint"
              : "bg-indigo/15 text-indigo hover:bg-indigo/25",
          )}
        >
          {busy ? W.working : W.button}
        </button>
      </div>
    </div>
  );
}
