import { describe, it, expect } from "vitest";
import { parseDnsLine, parseDnsLog } from "./dns";

describe("parseDnsLine", () => {
  it("ignores non-DNS lines", () => {
    expect(parseDnsLine("INFO inbound/mixed: connection from 127.0.0.1", 0)).toBeNull();
  });

  it("extracts the queried domain", () => {
    const e = parseDnsLine("DEBUG dns: exchanged google.com. IN A", 1000);
    expect(e?.domain).toBe("google.com");
    expect(e?.ts).toBe(1000);
  });

  it("extracts a resolved IP when present", () => {
    const e = parseDnsLine("dns: query example.org resolved 93.184.216.34", 0);
    expect(e?.domain).toBe("example.org");
    expect(e?.result).toBe("93.184.216.34");
  });

  it("matches the domain= form", () => {
    const e = parseDnsLine("router: dns request domain=cloudflare.com", 0);
    expect(e?.domain).toBe("cloudflare.com");
  });
});

describe("parseDnsLog", () => {
  it("keeps only DNS lines, preserving order", () => {
    const lines = [
      "INFO core started",
      "DEBUG dns: exchanged a.com. IN A",
      "WARN something unrelated",
      "DEBUG dns: exchanged b.net. IN AAAA",
    ];
    const out = parseDnsLog(lines, 0);
    expect(out.map((e) => e.domain)).toEqual(["a.com", "b.net"]);
  });
});
