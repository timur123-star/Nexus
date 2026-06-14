import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the IPC layer so registerWarp never touches Tauri — we feed it a
// canned Cloudflare registration response and assert the link it produces.
const warpRegister = vi.fn<(pub: string) => Promise<string>>();
vi.mock("./ipc", () => ({ warpRegister: (pub: string) => warpRegister(pub) }));

import { registerWarp } from "./warp";
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

describe("registerWarp", () => {
  beforeEach(() => warpRegister.mockReset());

  it("builds an importable wireguard:// link from a registration response", async () => {
    warpRegister.mockResolvedValue(regResponse());
    const link = await registerWarp();
    expect(link.startsWith("wireguard://")).toBe(true);

    const server = parseShareLink(link);
    expect(server.protocol).toBe("wireguard");
    expect(server.address).toBe("162.159.192.1");
    expect(server.port).toBe(2408);
    expect(server.wireguard?.peerPublicKey).toBe(
      "bmNvcmVQZWVyUHViS2V5MDAwMDAwMDAwMDAwMDAwMD0=",
    );
    // client_id "xKRj" decodes to [196,164,99] → reserved must round-trip.
    expect(server.wireguard?.reserved).toEqual([196, 164, 99]);
    expect(server.wireguard?.mtu).toBe(1280);
    // Both v4/32 and v6/128 should be present.
    expect(server.wireguard?.localAddress).toContain("172.16.0.2/32");
    expect(server.wireguard?.localAddress?.some((a) => a.includes("/128"))).toBe(true);
  });

  it("falls back to 0,0,0 reserved when client_id is missing", async () => {
    warpRegister.mockResolvedValue(regResponse({ client_id: undefined }));
    const server = parseShareLink(await registerWarp());
    expect(server.wireguard?.reserved).toEqual([0, 0, 0]);
  });

  it("throws a clear error when the peer key is absent", async () => {
    warpRegister.mockResolvedValue(JSON.stringify({ config: { peers: [] } }));
    await expect(registerWarp()).rejects.toThrow(/no peer key/i);
  });

  it("throws when registration is unavailable (outside the app)", async () => {
    warpRegister.mockResolvedValue("");
    await expect(registerWarp()).rejects.toThrow(/unavailable/i);
  });
});
