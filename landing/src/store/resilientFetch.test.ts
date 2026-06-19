import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the IPC layer so fetchSubscriptionResilient is testable without Tauri.
const fetchInfo = vi.fn();
vi.mock("../core/ipc", () => ({
  fetchSubscriptionInfo: (url: string, insecure: boolean, ua: string) =>
    fetchInfo(url, insecure, ua),
  pingServer: vi.fn(),
}));
// Avoid pulling the real persistence/db layer into the node test env.
vi.mock("../core/db", () => ({
  persistentStorage: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
}));

import { fetchSubscriptionResilient, isBareIpHttpsUrl, isTlsCertError } from "./useServerStore";

const PAYLOAD = { body: "vless://x", userinfo: "", profileTitle: "" };

beforeEach(() => fetchInfo.mockReset());

describe("isBareIpHttpsUrl", () => {
  it("matches https bare IPv4 hosts", () => {
    expect(isBareIpHttpsUrl("https://195.35.24.251/sub/abc#RU")).toBe(true);
    expect(isBareIpHttpsUrl("https://87.228.102.178/sub/x")).toBe(true);
  });
  it("matches https bare IPv6 literals", () => {
    expect(isBareIpHttpsUrl("https://[2606:4700:4700::1111]/sub")).toBe(true);
  });
  it("does NOT match real hostnames or http", () => {
    expect(isBareIpHttpsUrl("https://sub.example.com/x")).toBe(false);
    expect(isBareIpHttpsUrl("http://195.35.24.251/sub")).toBe(false);
    expect(isBareIpHttpsUrl("not a url")).toBe(false);
  });
});

describe("fetchSubscriptionResilient", () => {
  it("returns immediately when the first secure attempt succeeds", async () => {
    fetchInfo.mockResolvedValueOnce(PAYLOAD);
    const r = await fetchSubscriptionResilient("https://sub.example.com/x", false, "UA");
    expect(r.insecureCertAccepted).toBe(false);
    expect(fetchInfo).toHaveBeenCalledTimes(1);
  });

  it("retries insecure when the native error names a certificate problem", async () => {
    fetchInfo
      .mockRejectedValueOnce(
        new Error(
          "error sending request for url (https://h/x): invalid peer certificate: UnknownIssuer",
        ),
      )
      .mockResolvedValueOnce(PAYLOAD);
    const r = await fetchSubscriptionResilient("https://sub.example.com/x", false, "UA");
    expect(r.insecureCertAccepted).toBe(true);
    expect(fetchInfo).toHaveBeenNthCalledWith(2, "https://sub.example.com/x", true, "UA");
  });

  it("retries insecure for a bare-IP https panel even when the error is opaque", async () => {
    // This is exactly his case: 'error sending request for url' with no cert wording.
    fetchInfo
      .mockRejectedValueOnce(
        new Error("error sending request for url (https://195.35.24.251/sub/i3)"),
      )
      .mockResolvedValueOnce(PAYLOAD);
    const r = await fetchSubscriptionResilient("https://195.35.24.251/sub/i3", false, "UA");
    expect(r.insecureCertAccepted).toBe(true);
    expect(fetchInfo).toHaveBeenCalledTimes(2);
  });

  it("does NOT downgrade a real HTTP status error", async () => {
    fetchInfo.mockRejectedValueOnce(new Error("HTTP 404 Not Found"));
    await expect(
      fetchSubscriptionResilient("https://195.35.24.251/sub/i3", false, "UA"),
    ).rejects.toThrow(/404/);
    expect(fetchInfo).toHaveBeenCalledTimes(1);
  });

  it("does not retry when already insecure", async () => {
    fetchInfo.mockRejectedValueOnce(new Error("invalid peer certificate"));
    await expect(
      fetchSubscriptionResilient("https://195.35.24.251/sub/i3", true, "UA"),
    ).rejects.toThrow();
    expect(fetchInfo).toHaveBeenCalledTimes(1);
  });

  it("isTlsCertError still ignores innocent substrings", () => {
    expect(isTlsCertError("missing header")).toBe(false);
    expect(isTlsCertError("invalid peer certificate: UnknownIssuer")).toBe(true);
  });
});
