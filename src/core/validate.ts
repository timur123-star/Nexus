/**
 * Pre-flight validation of a ServerProfile before the core is launched.
 *
 * The cores (Xray / sing-box) reject incomplete configs with cryptic, low-level
 * errors and then crash-loop (e.g. a REALITY node missing its `publicKey` makes
 * Xray exit with `Failed to build REALITY config > empty "publicKey"` on every
 * restart). Catching these here lets the UI show one clear, actionable message
 * and skip the doomed launch instead of hammering a dead config.
 */
import type { Lang } from "./i18n";
import type { ServerProfile } from "./types";

/** Stable, localizable validation failure codes. */
export type ValidationCode =
  | "missing_address"
  | "missing_port"
  | "reality_missing_pbk"
  | "missing_uuid"
  | "missing_password"
  | "missing_ss_method"
  | "wireguard_incomplete"
  | "unsupported_anytls";

export interface ValidationError {
  code: ValidationCode;
  /** Already-localized, user-facing message. */
  message: string;
}

const MESSAGES: Record<ValidationCode, Record<Lang, string>> = {
  missing_address: {
    en: "Server has no address. Re-import the link.",
    ru: "У сервера нет адреса. Переимпортируйте ссылку.",
    fa: "سرور آدرس ندارد. لینک را دوباره وارد کنید.",
    zh: "服务器没有地址。请重新导入链接。",
  },
  missing_port: {
    en: "Server has no valid port. Re-import the link.",
    ru: "У сервера нет корректного порта. Переимпортируйте ссылку.",
    fa: "سرور پورت معتبر ندارد. لینک را دوباره وارد کنید.",
    zh: "服务器没有有效端口。请重新导入链接。",
  },
  reality_missing_pbk: {
    en: "REALITY server is missing its public key (pbk). The share link is incomplete — re-import a link that includes the pbk= parameter.",
    ru: "У сервера REALITY нет публичного ключа (pbk). Ссылка неполная — переимпортируйте ссылку с параметром pbk=.",
    fa: "سرور REALITY کلید عمومی (pbk) ندارد. لینک ناقص است — لینکی شامل پارامتر pbk= را دوباره وارد کنید.",
    zh: "REALITY 服务器缺少公钥 (pbk)。分享链接不完整——请重新导入包含 pbk= 参数的链接。",
  },
  missing_uuid: {
    en: "Server is missing its UUID. Re-import the link.",
    ru: "У сервера отсутствует UUID. Переимпортируйте ссылку.",
    fa: "UUID سرور موجود نیست. لینک را دوباره وارد کنید.",
    zh: "服务器缺少 UUID。请重新导入链接。",
  },
  missing_password: {
    en: "Server is missing its password. Re-import the link.",
    ru: "У сервера отсутствует пароль. Переимпортируйте ссылку.",
    fa: "رمز عبور سرور موجود نیست. لینک را دوباره وارد کنید.",
    zh: "服务器缺少密码。请重新导入链接。",
  },
  missing_ss_method: {
    en: "Shadowsocks server is missing its cipher (method). Re-import the link.",
    ru: "У сервера Shadowsocks нет шифра (method). Переимпортируйте ссылку.",
    fa: "سرور Shadowsocks رمزنگاری (method) ندارد. لینک را دوباره وارد کنید.",
    zh: "Shadowsocks 服务器缺少加密方式 (method)。请重新导入链接。",
  },
  wireguard_incomplete: {
    en: "WireGuard server is missing its keys. Re-import the link.",
    ru: "У сервера WireGuard отсутствуют ключи. Переимпортируйте ссылку.",
    fa: "کلیدهای سرور WireGuard موجود نیست. لینک را دوباره وارد کنید.",
    zh: "WireGuard 服务器缺少密钥。请重新导入链接。",
  },
  unsupported_anytls: {
    en: "AnyTLS isn't supported by the bundled cores (sing-box 1.11 / Xray). Use a VLESS / Trojan / Hysteria2 server instead.",
    ru: "AnyTLS не поддерживается встроенными ядрами (sing-box 1.11 / Xray). Используйте сервер VLESS / Trojan / Hysteria2.",
    fa: "AnyTLS توسط هسته‌های همراه (sing-box 1.11 / Xray) پشتیبانی نمی‌شود. به‌جای آن از سرور VLESS / Trojan / Hysteria2 استفاده کنید.",
    zh: "内置内核（sing-box 1.11 / Xray）不支持 AnyTLS。请改用 VLESS / Trojan / Hysteria2 服务器。",
  },
};

function firstFailure(server: ServerProfile): ValidationCode | null {
  if (!server.address || !server.address.trim()) return "missing_address";
  // Tor uses an embedded SOCKS port; everything else needs a real remote port.
  if (server.protocol !== "tor" && (!server.port || server.port <= 0 || server.port > 65535)) {
    return "missing_port";
  }

  // REALITY (Xray/sing-box) cannot build a handshake without the server's
  // public key — this is the exact failure seen in the field core.log.
  if (server.tls?.security === "reality" && !(server.tls.publicKey ?? "").trim()) {
    return "reality_missing_pbk";
  }

  switch (server.protocol) {
    case "vless":
    case "vmess":
      if (!(server.uuid ?? "").trim()) return "missing_uuid";
      break;
    case "anytls":
      // AnyTLS landed in sing-box 1.12; the bundled core is 1.11.1 and Xray
      // never supported it. Generating a config would crash the core with
      // "unknown outbound type: anytls", so reject it up-front with guidance.
      return "unsupported_anytls";
    case "trojan":
    case "hysteria2":
    case "hysteria":
      if (!(server.password ?? "").trim()) return "missing_password";
      break;
    case "tuic":
      // TUIC authenticates with uuid + password.
      if (!(server.uuid ?? "").trim()) return "missing_uuid";
      if (!(server.password ?? "").trim()) return "missing_password";
      break;
    case "shadowsocks":
      if (!(server.method ?? "").trim()) return "missing_ss_method";
      if (!(server.password ?? "").trim()) return "missing_password";
      break;
    case "wireguard":
      if (!server.wireguard?.privateKey?.trim() || !server.wireguard?.peerPublicKey?.trim()) {
        return "wireguard_incomplete";
      }
      break;
    default:
      break;
  }
  return null;
}

/**
 * Returns a localized ValidationError if the server can't possibly launch, or
 * null when it passes the pre-flight checks.
 */
export function validateServerForLaunch(
  server: ServerProfile,
  lang: Lang = "en",
): ValidationError | null {
  const code = firstFailure(server);
  if (!code) return null;
  return { code, message: MESSAGES[code][lang] ?? MESSAGES[code].en };
}
