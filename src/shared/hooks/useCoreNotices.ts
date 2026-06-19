import { useEffect } from "react";
import { onCoreNotice, type CoreNotice } from "../../core/ipc";
import { useSettingsStore } from "../../store/useSettingsStore";
import { activateGvisorFallback } from "../../store/useConnectionStore";
import { toast } from "../../store/useToastStore";

type Lang = "ru" | "en" | "fa" | "zh";
type Level = "error" | "warning" | "info";

/**
 * Friendly, localized text for each backend diagnostic code. Kept screen-local
 * (not in the global i18n dictionary) so adding/removing a notice never trips
 * the strict key-parity test.
 */
const NOTICE: Record<CoreNotice, { level: Level; text: Record<Lang, string> }> = {
  port_in_use: {
    level: "error",
    text: {
      ru: "Локальный порт уже занят — смените его в настройках",
      en: "The local proxy port is already in use — change it in Settings",
      fa: "پورت پروکسی محلی در حال استفاده است — آن را در تنظیمات تغییر دهید",
      zh: "本地代理端口已被占用 — 请在设置中更改",
    },
  },
  auth_failed: {
    level: "error",
    text: {
      ru: "Сервер отклонил данные — переимпортируйте конфиг",
      en: "The server rejected the credentials — re-import the config",
      fa: "سرور اعتبارنامه را رد کرد — پیکربندی را دوباره وارد کنید",
      zh: "服务器拒绝了凭据 — 请重新导入配置",
    },
  },
  tls_error: {
    level: "error",
    text: {
      ru: "Ошибка TLS-рукопожатия — проверьте SNI/host или сертификат",
      en: "TLS handshake failed — check the SNI/host or certificate",
      fa: "دست‌دادن TLS ناموفق بود — SNI/host یا گواهی را بررسی کنید",
      zh: "TLS 握手失败 — 请检查 SNI/host 或证书",
    },
  },
  dns_error: {
    level: "error",
    text: {
      ru: "Не удалось разрешить адрес сервера — проверьте имя/DNS",
      en: "Couldn't resolve the server address — check the hostname/DNS",
      fa: "آدرس سرور حل نشد — نام میزبان/DNS را بررسی کنید",
      zh: "无法解析服务器地址 — 请检查主机名/DNS",
    },
  },
  server_unreachable: {
    level: "error",
    text: {
      ru: "Сервер недоступен — попробуйте другой",
      en: "The server is unreachable — try another one",
      fa: "سرور در دسترس نیست — سرور دیگری را امتحان کنید",
      zh: "服务器不可达 — 请尝试其他服务器",
    },
  },
  config_invalid: {
    level: "error",
    text: {
      ru: "Конфиг отклонён ядром — профиль может быть повреждён",
      en: "The config was rejected by the core — the profile may be malformed",
      fa: "پیکربندی توسط هسته رد شد — ممکن است نمایه خراب باشد",
      zh: "配置被内核拒绝 — 配置文件可能已损坏",
    },
  },
  need_admin: {
    level: "warning",
    text: {
      ru: "Недостаточно прав — запустите приложение от администратора",
      en: "Missing privileges — run the app as administrator",
      fa: "دسترسی کافی نیست — برنامه را با دسترسی مدیر اجرا کنید",
      zh: "权限不足 — 请以管理员身份运行应用",
    },
  },
  tun_firewall: {
    level: "info",
    text: {
      ru: "Системный TUN-стек недоступен на этой машине — переключаюсь на gVisor",
      en: "The system TUN stack isn't available on this machine — switching to gVisor",
      fa: "پشتهٔ TUN سیستمی روی این دستگاه در دسترس نیست — تغییر به gVisor",
      zh: "此设备不支持系统 TUN 堆栈 — 正在切换到 gVisor",
    },
  },
  core_restarting: {
    level: "info",
    text: {
      ru: "Восстанавливаю соединение…",
      en: "Recovering the connection…",
      fa: "در حال بازیابی اتصال…",
      zh: "正在恢复连接…",
    },
  },
  core_failed_start: {
    level: "error",
    text: {
      ru: "Ядро не запустилось — проверьте сервер и конфиг",
      en: "The core failed to start — check the server and config",
      fa: "هسته راه‌اندازی نشد — سرور و پیکربندی را بررسی کنید",
      zh: "内核启动失败 — 请检查服务器和配置",
    },
  },
  core_timeout: {
    level: "error",
    text: {
      ru: "Ядро не успело запуститься — попробуйте ещё раз",
      en: "The core didn't become ready in time — try again",
      fa: "هسته به‌موقع آماده نشد — دوباره تلاش کنید",
      zh: "内核未能及时就绪 — 请重试",
    },
  },
  core_unrecoverable: {
    level: "error",
    text: {
      ru: "Ядро постоянно падает — выберите другой сервер",
      en: "The core keeps crashing — pick another server",
      fa: "هسته مدام از کار می‌افتد — سرور دیگری انتخاب کنید",
      zh: "内核持续崩溃 — 请��择其他服务器",
    },
  },
  tor_missing: {
    level: "error",
    text: {
      ru: "Для Tor нужен внешний исполняемый файл «tor» в PATH — он не входит в комплект. Установите Tor или выберите другой сервер.",
      en: "Tor needs an external 'tor' executable on PATH — it isn't bundled. Install Tor or pick another server.",
      fa: "Tor به فایل اجرایی خارجی «tor» در PATH نیاز دارد — همراه برنامه ارائه نمی‌شود. Tor را نصب کنید یا سرور دیگری انتخاب کنید.",
      zh: "Tor 需要 PATH 中存在外部 “tor” 可执行文件——它未随附捆绑。请安装 Tor 或选择其他服务器。",
    },
  },
};

/**
 * Surface backend `core://notice` diagnostics as friendly, localized toasts so
 * the user sees an actionable explanation instead of a raw core error string.
 * To avoid spamming, the same notice is suppressed if it repeats within a short
 * window (cores often log the same failure on every retry).
 */
export function useCoreNotices(): void {
  useEffect(() => {
    let alive = true;
    let unsub: (() => void) | null = null;
    const lastShown = new Map<CoreNotice, number>();
    const DEDUPE_MS = 4000;

    onCoreNotice((code) => {
      // The system TUN stack couldn't register its Windows firewall rule on
      // this machine; switch to the userspace gVisor stack so the next
      // (auto-)reconnect brings the tunnel up with no user action.
      if (code === "tun_firewall") activateGvisorFallback();

      const entry = NOTICE[code];
      if (!entry) return;
      const now = Date.now();
      const prev = lastShown.get(code) ?? 0;
      if (now - prev < DEDUPE_MS) return;
      lastShown.set(code, now);

      const lang = useSettingsStore.getState().app.language;
      const msg = entry.text[lang];
      if (entry.level === "error") toast.error(msg);
      else if (entry.level === "warning") toast.warning(msg);
      else toast.info(msg);
    }).then((u) => {
      if (alive) unsub = u;
      else u();
    });

    return () => {
      alive = false;
      if (unsub) unsub();
    };
  }, []);
}
