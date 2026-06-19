import { describe, expect, it, beforeEach } from "vitest";
import {
  BACKUP_MAGIC,
  BACKUP_VERSION,
  buildBackup,
  serializeBackup,
  parseBackup,
  applyBackup,
  type BackupFile,
} from "./backup";
import { useServerStore } from "../store/useServerStore";
import { useSettingsStore } from "../store/useSettingsStore";

const sampleServer: any = {
  id: "s1",
  name: "Tokyo",
  protocol: "vless",
  address: "jp.example.com",
  port: 443,
  uuid: "uuid-1",
  transport: { type: "tcp" },
  tls: { enabled: true, security: "tls" },
  tags: [],
  favorite: false,
  latencyMs: null,
  createdAt: 0,
};

describe("backup serialize / parse", () => {
  beforeEach(() => {
    useServerStore.setState({ servers: [], subscriptions: [] });
  });

  it("buildBackup stamps the magic, version and current state", () => {
    useServerStore.setState({ servers: [sampleServer], subscriptions: [] });
    const b = buildBackup();
    expect(b.app).toBe(BACKUP_MAGIC);
    expect(b.version).toBe(BACKUP_VERSION);
    expect(b.servers).toHaveLength(1);
    expect(typeof b.exportedAt).toBe("string");
    expect(new Date(b.exportedAt).toString()).not.toBe("Invalid Date");
  });

  it("serialize → parse is a lossless round-trip", () => {
    useServerStore.setState({ servers: [sampleServer], subscriptions: [] });
    const text = serializeBackup();
    const parsed = parseBackup(text);
    expect(parsed.app).toBe(BACKUP_MAGIC);
    expect(parsed.servers[0]).toMatchObject({ id: "s1", address: "jp.example.com", port: 443 });
  });

  it("rejects non-JSON", () => {
    expect(() => parseBackup("not json {")).toThrow(/valid JSON/i);
  });

  it("rejects JSON that is not a NexusShield backup", () => {
    expect(() => parseBackup(JSON.stringify({ hello: "world" }))).toThrow(/NexusShield backup/i);
  });

  it("rejects a backup missing the server list", () => {
    const bad = JSON.stringify({ app: BACKUP_MAGIC, settings: {}, servers: "nope" });
    expect(() => parseBackup(bad)).toThrow(/server list/i);
  });

  it("rejects a backup with no settings object", () => {
    const bad = JSON.stringify({ app: BACKUP_MAGIC, servers: [] });
    expect(() => parseBackup(bad)).toThrow(/settings/i);
  });

  it("rejects a corrupt (non-array) subscription list instead of silently dropping it", () => {
    const bad = JSON.stringify({
      app: BACKUP_MAGIC,
      settings: { app: {}, proxy: {} },
      servers: [],
      subscriptions: null,
    });
    expect(() => parseBackup(bad)).toThrow(/subscription/i);
  });

  it("still accepts a backup that simply omits subscriptions (forward-compat)", () => {
    const ok = JSON.stringify({ app: BACKUP_MAGIC, settings: { app: {}, proxy: {} }, servers: [] });
    expect(() => parseBackup(ok)).not.toThrow();
  });
});

describe("applyBackup", () => {
  beforeEach(() => {
    useServerStore.setState({ servers: [], subscriptions: [] });
  });

  it("loads servers + subscriptions onto the live store and reports counts", () => {
    const file: BackupFile = {
      app: BACKUP_MAGIC,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      settings: { app: {} as any, proxy: {} as any },
      servers: [sampleServer, { ...sampleServer, id: "s2", name: "Osaka" }],
      subscriptions: [{ id: "sub1" } as any],
    };
    const res = applyBackup(file);
    expect(res).toEqual({ servers: 2, subscriptions: 1 });
    expect(useServerStore.getState().servers.map((s) => s.id)).toEqual(["s1", "s2"]);
    // The store's action methods must survive a setState merge.
    expect(typeof useServerStore.getState().addFromBlob).toBe("function");
  });

  it("tolerates an older backup with missing arrays (falls back to empty)", () => {
    const res = applyBackup({
      app: BACKUP_MAGIC,
      version: 0,
      exportedAt: "",
      settings: {} as any,
      servers: undefined as any,
      subscriptions: undefined as any,
    });
    expect(res).toEqual({ servers: 0, subscriptions: 0 });
  });
});
