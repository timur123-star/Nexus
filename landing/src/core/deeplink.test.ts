import { describe, expect, it } from "vitest";
import { parseDeepLink } from "./deeplink";

const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64");
const b64url = (s: string) => b64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("parseDeepLink", () => {
  it("returns null for anything that is not a nexusshield:// link", () => {
    expect(parseDeepLink("https://example.com")).toBeNull();
    expect(parseDeepLink("vless://u@h:443")).toBeNull();
    expect(parseDeepLink("   ")).toBeNull();
    expect(parseDeepLink("nexusshield://")).toBeNull();
  });

  it("decodes a base64 blob behind /import/", () => {
    const blob = "vless://u@h:443#a\nvless://u@h:444#b";
    const r = parseDeepLink(`nexusshield://import/${b64(blob)}`);
    expect(r?.blob).toBe(blob);
  });

  it("tolerates URL-safe base64 without padding", () => {
    const blob = "trojan://p@host.com:443#T??";
    const r = parseDeepLink(`nexusshield://import/${b64url(blob)}`);
    expect(r?.blob).toBe(blob);
  });

  it("reads both data and subscription url from the query string", () => {
    const blob = "ss://YWVzLTI1Ni1nY206cHc@1.2.3.4:8388#s";
    const sub = "https://sub.example.com/x";
    const r = parseDeepLink(
      `nexusshield://import?data=${encodeURIComponent(b64(blob))}&url=${encodeURIComponent(sub)}`,
    );
    expect(r?.blob).toBe(blob);
    expect(r?.subscriptionUrl).toBe(sub);
  });

  it("accepts ?sub= as an alias for the subscription url", () => {
    const sub = "https://panel.example.com/sub/abc";
    const r = parseDeepLink(`nexusshield://import?sub=${encodeURIComponent(sub)}`);
    expect(r?.subscriptionUrl).toBe(sub);
    expect(r?.blob).toBeUndefined();
  });

  it("treats /add/<link> as a single, url-decoded share link", () => {
    const link = "vless://u@h:443?type=ws&path=/a b#name with spaces";
    const r = parseDeepLink(`nexusshield://add/${encodeURIComponent(link)}`);
    expect(r?.blob).toBe(link);
  });

  it("falls back to treating an unknown action's (encoded) remainder as a blob", () => {
    const link = "vless://u@h:443#x";
    const r = parseDeepLink(`nexusshield://whatever/${encodeURIComponent(link)}`);
    expect(r?.blob).toBe(link);
  });

  it("does not mistake binary garbage for a decoded blob", () => {
    // A payload whose base64 decodes to control bytes must not be returned raw.
    const r = parseDeepLink(`nexusshield://import/${b64("\x00\x01\x02\x07")}`);
    // Either null, or it kept the *encoded* form (never the binary decode).
    if (r?.blob) expect(/[\x00-\x08]/.test(r.blob)).toBe(false);
  });

  it("is case-insensitive on the scheme", () => {
    const link = "vless://u@h:443";
    const r = parseDeepLink(`NEXUSSHIELD://add/${encodeURIComponent(link)}`);
    expect(r?.blob).toBe(link);
  });
});
