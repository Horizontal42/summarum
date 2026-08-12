import { describe, it, expect } from "vitest";
import { formatNumber, formatValue } from "./formatter";
import type { DateVal, ChartValue, EngineSettings } from "./types";
import { Decimal, defaultSettings, qty, pct } from "./types";

describe("formatNumber", () => {
  it("formats standard numbers", () => {
    expect(formatNumber(new Decimal("12.345"), defaultSettings)).toBe("12.35");
    expect(formatNumber(new Decimal("100"), defaultSettings)).toBe("100");
  });

  it("handles custom group separators", () => {
    const s: EngineSettings = { ...defaultSettings, groupSeparator: " " };
    expect(formatNumber(new Decimal("1234567.89"), s)).toBe("1 234 567.89");
  });

  it("handles custom decimal separators", () => {
    const s: EngineSettings = { ...defaultSettings, decimalSeparator: "," };
    expect(formatNumber(new Decimal("12.345"), s)).toBe("12,35");
  });

  it("handles scientific notation strings automatically", () => {
    expect(formatNumber(new Decimal("1e25"), defaultSettings)).toBe("1e+25");
  });

  it("applies significant digits fallback for numbers close to zero", () => {
    // 0.001 rounded to 0 decimals is 0, but since >= 1e-12, it shows significant digits
    const s: EngineSettings = { ...defaultSettings, precision: 0 };
    expect(formatNumber(new Decimal("0.001"), s)).toBe("0.001");
  });

  it("treats numbers < 1e-12 as conversion noise", () => {
    const s: EngineSettings = { ...defaultSettings, precision: 2 };
    expect(formatNumber(new Decimal("1e-13"), s)).toBe("0");
  });
});

describe("formatValue", () => {
  it("formats chart as empty string", () => {
    const v: ChartValue = { kind: "chart", points: [], unitLabel: null };
    expect(formatValue(v, defaultSettings)).toBe("");
  });

  it("formats percent values", () => {
    expect(formatValue(pct(25.5), defaultSettings)).toBe("25.5%");
  });

  it("formats dates depending on flags", () => {
    // 2024-01-01 12:00:00 UTC = 1704110400000
    const d: DateVal = { kind: "date", ms: 1704110400000, hasTime: false, timeZone: "UTC" };
    expect(formatValue(d, { ...defaultSettings, dateFormat: "iso" })).toBe("2024-01-01");
    expect(formatValue(d, { ...defaultSettings, dateFormat: "dmy" })).toBe("01.01.2024");
    expect(formatValue(d, { ...defaultSettings, dateFormat: "mdy" })).toBe("01/01/2024");

    // Test timeOnly
    const dTime: DateVal = { kind: "date", ms: 1704110400000, hasTime: true, timeZone: "UTC", timeOnly: true };
    expect(formatValue(dTime, defaultSettings)).toBe("12:00");
  });

  it("formats base conversions", () => {
    expect(formatValue(qty(255, null, "hex"), defaultSettings)).toBe("0xFF");
    expect(formatValue(qty(-255, null, "hex"), defaultSettings)).toBe("-0xFF");
    expect(formatValue(qty(5, null, "binary"), defaultSettings)).toBe("0b101");
    expect(formatValue(qty(8, null, "octal"), defaultSettings)).toBe("0o10");
  });

  it("formats representations", () => {
    expect(formatValue(qty(123456, null, "scientific"), defaultSettings)).toBe("1.23e5");
    expect(formatValue(qty(1234.56, null, "plain"), defaultSettings)).toBe("1234.56");
    expect(formatValue(qty(0.75, null, "fraction"), defaultSettings)).toBe("3/4");
    expect(formatValue(qty(14, null, "roman"), defaultSettings)).toBe("XIV");
  });

  it("formats Roman numerals fallbacks", () => {
    // Beyond 3999 falls back to formatNumber
    expect(formatValue(qty(4000, null, "roman"), defaultSettings)).toBe("4,000");
  });

  it("formats units", () => {
    const cm = { id: "cm", dimension: "length" as const, ratio: new Decimal(0.01), format: "cm" };
    expect(formatValue(qty(10, cm), defaultSettings)).toBe("10 cm");

    const degC = { id: "degC", dimension: "temperature" as const, ratio: new Decimal(1), format: "°C" };
    expect(formatValue(qty(25, degC), defaultSettings)).toBe("25°C");

    const usd = { id: "USD", dimension: "currency" as const, ratio: new Decimal(1), format: "${}" };
    expect(formatValue(qty(100, usd), defaultSettings)).toBe("$100");
  });
});
