import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the IPC layer so registerWarp never touches Tauri. `warpRegister` is the
// direct-Cloudflare fallback used only when the relay fails.
const warpRegister = vi.fn<(pub: string) => Promise<string>>();
vi.mock("./ipc", () => ({ warpRegister: (pub: string) => warpRegister(pub) }));

import { registerWarp, DEFAULT_WARP_RELAY } from "./warp";
import { parseShareLink } from "./parser";

// A trimmed-but-realistic v0a2485 /reg response.
function regResponse(configOver: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "t.abc",
    account: { license: "ABC123" },
    config: {
      client_id: "xKRj", // base64 of bytes [196,164,99]
      peers: [
        {
          public_key: "bmNvcmVQZWVyUHViS2V5MDAwMDAwMDAwMDAwMDAwMD0=",
          endpoint: { host: "162.159.192.1:2408" },
        },
      ],
      interface: { addresses: { v4: "172.16.0.2", v6: "2606:4700:110:0:0:0:0:1" } },
      ...configOver,
    },
  });
}

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const m = vi.fn(impl);
  vi.stubGlobal("fetch", m);
  return m;
}

afterEach(() => vi.unstubAllGlobals());

describe("registerWarp (default = built-in relay)", () => {
  beforeEach(() => warpRegister.mockReset());

  it("enrolls through the built-in relay with no configuration and builds a link", async () => {
    const fetchMock = stubFetch(async () => new Response(regResponse(), { status: 200 }));
    const link = await registerWarp();
    expect(link.startsWith("wireguard://")).toBe(true);
    // No arg → the built-in relay's /reg endpoint is hit, not Rust IPC.
    expect(fetchMock.mock.calls[0][0]).toBe(`${DEFAULT_WARP_RELAY}/reg`);
    expect(warpRegister).not.toHaveBeenCalled();

    const server = parseShareLink(link);
    expect(server.protocol).toBe("wireguard");
    expect(server.address).toBe("162.159.192.1");
    expect(server.port).toBe(2408);
    expect(server.wireguard?.peerPublicKey).toBe("bmNvcmVQZWVyUHViS2V5MDAwMDAwMDAwMDAwMDAwMD0=");
    expect(server.wireguard?.reserved).toEqual([196, 164, 99]);
    expect(server.wireguard?.mtu).toBe(1280);
    expect(server.wireguard?.localAddress).toContain("172.16.0.2/32");
    expect(server.wireguard?.localAddress?.some((a) => a.includes("/128"))).toBe(true);
  });

  it("falls back to 0,0,0 reserved when client_id is missing", async () => {
    stubFetch(async () => new Response(regResponse({ client_id: undefined }), { status: 200 }));
    const server = parseShareLink(await registerWarp());
    expect(server.wireguard?.reserved).toEqual([0, 0, 0]);
  });

  it("throws a clear error when the peer key is absent", async () => {
    stubFetch(async () => new Response(JSON.stringify({ config: { peers: [] } }), { status: 200 }));
    await expect(registerWarp()).rejects.toThrow(/no peer key/i);
  });
});

describe("registerWarp relay → direct fallback", () => {
  beforeEach(() => warpRegister.mockReset());

  it("falls back to a direct Cloudflare enrollment when the relay is down", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    warpRegister.mockResolvedValue(regResponse());
    const link = await registerWarp();
    expect(link.startsWith("wireguard://")).toBe(true);
    expect(warpRegister).toHaveBeenCalledTimes(1);
  });

  it("surfaces the relay error when both relay and direct fallback fail", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    warpRegister.mockResolvedValue(""); // direct path also unavailable (e.g. outside app)
    await expect(registerWarp()).rejects.toThrow(/could not reach the warp relay/i);
  });
});

describe("registerWarp via custom relay URL", () => {
  beforeEach(() => warpRegister.mockReset());

  it("uses a user-configured relay over the default, posting the public key to /reg", async () => {
    const fetchMock = stubFetch(async () => new Response(regResponse(), { status: 200 }));
    await registerWarp("https://relay.example.com/");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://relay.example.com/reg"); // trailing slash collapsed
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string) as { key: string };
    expect(body.key.length).toBeGreaterThan(0);
  });

  it("does not double-append /reg when the URL already ends in it", async () => {
    const fetchMock = stubFetch(async () => new Response(regResponse(), { status: 200 }));
    await registerWarp("https://relay.example.com/reg");
    expect(fetchMock.mock.calls[0][0]).toBe("https://relay.example.com/reg");
  });

  it("surfaces a clear error when the relay returns a non-2xx (and no fallback)", async () => {
    stubFetch(
      async () =>
        new Response(JSON.stringify({ error: "Cloudflare returned HTTP 403" }), { status: 502 }),
    );
    warpRegister.mockResolvedValue("");
    await expect(registerWarp("https://relay.example.com")).rejects.toThrow(/relay error.*403/i);
  });
});

