import { describe, it, expect } from "vitest";
import { translate } from "./index";
import { en, ru } from "./messages";

describe("i18n — dictionary integrity", () => {
  it("ru is at full key parity with en", () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
  });
});

describe("i18n — translate", () => {
  it("returns the language string when present", () => {
    expect(translate("ru", "nav.settings")).toBe("Настройки");
    expect(translate("en", "nav.settings")).toBe("Settings");
  });

  it("falls back to English for a partial language", () => {
    // zh has no settings.reset string, so it should inherit the English one.
    expect(translate("zh", "settings.reset")).toBe(translate("en", "settings.reset"));
  });

  it("uses the localised string when the partial language has it", () => {
    expect(translate("zh", "nav.servers")).toBe("服务器");
    expect(translate("fa", "conn.error")).toBe("خطا");
  });

  it("interpolates named placeholders", () => {
    expect(translate("en", "settings.mux.hint", { protocol: "smux" })).toBe(
      "Protocol: smux",
    );
    expect(translate("ru", "settings.mux.hint", { protocol: "yamux" })).toBe(
      "Протокол: yamux",
    );
  });

  it("leaves unknown placeholders untouched", () => {
    expect(translate("en", "settings.mux.hint", { other: "x" })).toBe(
      "Protocol: {protocol}",
    );
  });
});
