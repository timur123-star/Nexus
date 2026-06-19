import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the IPC layer so we control what the native fetch returns/throws.
const fetchSubscriptionInfo =
  vi.fn<(url: string, allowInsecure?: boolean, ua?: string) => Promise<unknown>>();
vi.mock("../core/ipc", () => ({
  fetchSubscriptionInfo: (u: string, ins?: boolean, ua?: string) =>
    fetchSubscriptionInfo(u, ins, ua),
  pingServer: vi.fn(),
}));

import { isTlsCertError, fetchSubscriptionResilient } from "./useServerStore";

const OK = { body: "vless://x@1.2.3.4:443?type=tcp#a", userinfo: "", profileTitle: "" };

describe("isTlsCertError", () => {
  it("matches reqwest/rustls certificate failures", () => {
    for (const m of [
      "invalid peer certificate: UnknownIssuer",
      "invalid peer certificate: NotValidForName",
      "error trying to connect: certificate verify failed",
      "the handshake failed: self-signed certificate",
      "webpki: cert not trusted",
    ]) {
      expect(isTlsCertError(m)).toBe(true);
    }
  });
  it("ignores unrelated network errors (incl. tricky substrings)", () => {
    expect(isTlsCertError("HTTP 404 Not Found")).toBe(false);
    expect(isTlsCertError("connection refused")).toBe(false);
    expect(isTlsCertError("dns error: failed to lookup address")).toBe(false);
    // Regression: short tokens must not match inside ordinary words.
    expect(isTlsCertError("invalid HTTP header in response")).toBe(false);
    expect(isTlsCertError("missing details: order timed out")).toBe(false);
    expect(isTlsCertError("operation timed out after 20s")).toBe(false);
  });
});

describe("fetchSubscriptionResilient", () => {
  beforeEach(() => fetchSubscriptionInfo.mockReset());

  it("retries insecure on a cert error, then succeeds (RU vk.ru-fronted panel)", async () => {
    fetchSubscriptionInfo
      .mockRejectedValueOnce(new Error("invalid peer certificate: UnknownIssuer"))
      .mockResolvedValueOnce(OK);
    const r = await fetchSubscriptionResilient(
      "https://87.228.102.178/sub/x",
      false,
      "Hiddify/4.1.1",
    );
    expect(r.insecureCertAccepted).toBe(true);
    expect(r.payload).toEqual(OK);
    // First attempt secure, retry insecure.
    expect(fetchSubscriptionInfo.mock.calls[0][1]).toBe(false);
    expect(fetchSubscriptionInfo.mock.calls[1][1]).toBe(true);
  });

  it("does NOT retry on a non-cert error (e.g. 404) — surfaces it", async () => {
    fetchSubscriptionInfo.mockRejectedValueOnce(new Error("HTTP 404 Not Found"));
    await expect(fetchSubscriptionResilient("https://host/sub", false, "UA")).rejects.toThrow(
      /404/,
    );
    expect(fetchSubscriptionInfo).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the user already allows insecure (single attempt)", async () => {
    fetchSubscriptionInfo.mockRejectedValueOnce(new Error("certificate verify failed"));
    await expect(fetchSubscriptionResilient("https://host/sub", true, "UA")).rejects.toThrow(
      /certificate/,
    );
    expect(fetchSubscriptionInfo).toHaveBeenCalledTimes(1);
  });

  it("passes through cleanly when the cert is valid (no retry, flag false)", async () => {
    fetchSubscriptionInfo.mockResolvedValueOnce(OK);
    const r = await fetchSubscriptionResilient("https://valid.example/sub", false, "UA");
    expect(r.insecureCertAccepted).toBe(false);
    expect(fetchSubscriptionInfo).toHaveBeenCalledTimes(1);
  });
});
