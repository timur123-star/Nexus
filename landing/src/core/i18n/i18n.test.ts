import { describe, it, expect } from "vitest";
import { translate } from "./index";
import { en, ru, fa, zh } from "./messages";

describe("i18n — dictionary integrity", () => {
  it("ru is at full key parity with en", () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
  });

  it("fa is at full key parity with en", () => {
    expect(Object.keys(fa).sort()).toEqual(Object.keys(en).sort());
  });

  it("zh is at full key parity with en", () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });
});

describe("i18n — translate", () => {
  it("returns the language string when present", () => {
    expect(translate("ru", "nav.settings")).toBe(
      "\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438",
    );
    expect(translate("en", "nav.settings")).toBe("Settings");
  });

  it("zh returns its own full translation (no English fallback)", () => {
    expect(translate("zh", "settings.reset")).toBe("\u91cd\u7f6e\u8bbe\u7f6e");
    expect(translate("zh", "nav.servers")).toBe("\u670d\u52a1\u5668");
  });

  it("fa returns its own full translation (no English fallback)", () => {
    expect(translate("fa", "conn.error")).toBe("\u062e\u0637\u0627");
    expect(translate("fa", "settings.reset")).toBe(
      "\u0628\u0627\u0632\u0646\u0634\u0627\u0646\u06cc \u062a\u0646\u0638\u06cc\u0645\u0627\u062a",
    );
  });

  it("interpolates named placeholders", () => {
    expect(translate("en", "settings.mux.hint", { protocol: "smux" })).toBe("Protocol: smux");
    expect(translate("ru", "settings.mux.hint", { protocol: "yamux" })).toBe(
      "\u041f\u0440\u043e\u0442\u043e\u043a\u043e\u043b: yamux",
    );
    expect(translate("zh", "settings.mux.hint", { protocol: "smux" })).toBe("\u534f\u8bae: smux");
  });

  it("leaves unknown placeholders untouched", () => {
    expect(translate("en", "settings.mux.hint", { other: "x" })).toBe("Protocol: {protocol}");
  });
});
