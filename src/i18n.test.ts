import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { setLang, t, detectLang } from "./i18n";

describe("i18n", () => {

  beforeEach(() => {

    const mockElements = [
      { dataset: { i18n: "settings" }, textContent: "" },
      { dataset: { i18n: "theme" }, textContent: "" }
    ];

    vi.stubGlobal("document", {
      documentElement: { lang: "" },
      querySelectorAll: vi.fn().mockReturnValue(mockElements)
    });
    vi.stubGlobal("navigator", { language: "en-US" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sets language and updates document lang", () => {
    setLang("ru");
    expect(t("settings")).toBe("Настройки");
    expect(document.documentElement.lang).toBe("ru");

    // Check if querySelectorAll was called and elements were updated
    const elements = document.querySelectorAll("[data-i18n]");
    expect(elements[0].textContent).toBe("Настройки");
    expect(elements[1].textContent).toBe("Тема");

    setLang("en");
    expect(t("settings")).toBe("Settings");
    expect(document.documentElement.lang).toBe("en");
  });

  it("falls back to en for unknown languages", () => {
    setLang("fr");
    expect(t("settings")).toBe("Settings");
    expect(document.documentElement.lang).toBe("en");
  });

  it("falls back to en dictionary for missing keys in ru", () => {
    // If a key exists in en but not ru, it should fallback to en
    // we don't have one right now, but we can test missing keys in both
    expect(t("unknown_key")).toBe("unknown_key");
  });

  it("detects language from navigator", () => {
    vi.stubGlobal("navigator", { language: "ru-RU" });
    expect(detectLang()).toBe("ru");

    vi.stubGlobal("navigator", { language: "en-US" });
    expect(detectLang()).toBe("en");

    vi.stubGlobal("navigator", { language: undefined });
    expect(detectLang()).toBe("en");
  });
});
