import { describe, it, expect, beforeEach } from "vitest";
import { buildRegistry, Registry } from "./registry";
import { lexLine } from "./lexer";
import { Decimal } from "./types";

describe("registry", () => {
  let reg: Registry;

  beforeEach(() => {
    reg = buildRegistry();
  });

  describe("buildRegistry", () => {
    it("initializes a valid Registry instance with core vocabulary", () => {
      // Check core words
      const plusPayload = reg.match(lexLine("plus"), ["plus"], 0);
      expect(plusPayload).not.toBeNull();
      expect(plusPayload?.payload.t).toBe("op");
      if (plusPayload?.payload.t === "op") expect(plusPayload.payload.op).toBe("plus");

      const piPayload = reg.match(lexLine("pi"), ["pi"], 0);
      expect(piPayload).not.toBeNull();
      expect(piPayload?.payload.t).toBe("const");
      if (piPayload?.payload.t === "const") expect(piPayload.payload.name).toBe("pi");
    });

    it("registers built-in functions", () => {
      expect(reg.isFunc("sin")).toBe(true);
      expect(reg.isFunc("sqrt")).toBe(true);
      expect(reg.isFunc("random")).toBe(true);
      expect(reg.isFunc("unknownFunc")).toBe(false);

      const sinPayload = reg.match(lexLine("sin"), ["sin"], 0);
      expect(sinPayload).not.toBeNull();
      expect(sinPayload?.payload.t).toBe("func");
    });

    it("registers common units", () => {
      // "meter"
      const meterPayload = reg.match(lexLine("meter"), ["meter"], 0);
      expect(meterPayload).not.toBeNull();
      expect(meterPayload?.payload.t).toBe("unit");

      // "kg" (strict/lenient)
      const kgPayload = reg.match(lexLine("kg"), ["kg"], 0);
      expect(kgPayload).not.toBeNull();
      expect(kgPayload?.payload.t).toBe("unit");

      // "USD" (strict/lenient currency)
      const usdPayload = reg.match(lexLine("USD"), ["usd"], 0);
      expect(usdPayload).not.toBeNull();
      expect(usdPayload?.payload.t).toBe("currency");
    });
  });

  describe("match", () => {
    it("matches single-word phrases", () => {
      const match = reg.match(lexLine("usd"), ["usd"], 0);
      expect(match).not.toBeNull();
      expect(match?.length).toBe(1);
    });

    it("matches multi-word phrases", () => {
      const match = reg.match(lexLine("square meter"), ["square", "meter"], 0);
      expect(match).not.toBeNull();
      expect(match?.length).toBe(2);
      expect(match?.payload.t).toBe("unit");
    });

    it("respects case-sensitivity", () => {
      // "m" (milli) vs "M" (mega)
      const mMatch = reg.match(lexLine("mm"), ["mm"], 0);
      const mPayload = mMatch?.payload;
      expect(mPayload?.t).toBe("unit");

      const MMatch = reg.match(lexLine("Mm"), ["mm"], 0);
      const MPayload = MMatch?.payload;
      expect(MPayload?.t).toBe("unit");

      if (mPayload?.t === "unit" && MPayload?.t === "unit") {
        expect(mPayload.unit.id).not.toBe(MPayload.unit.id);
        expect(mPayload.unit.id).toBe("milli:meter");
        expect(MPayload.unit.id).toBe("mega:meter");
      }
    });

    it("respects mustTouch flag", () => {
      // "log2" vs "log 2"
      const lex2 = lexLine("log2");
      const log2Match = reg.match(lex2, lex2.map(l => l.raw), 0);
      expect(log2Match).not.toBeNull();
      expect(log2Match?.payload.t).toBe("func");
      if (log2Match?.payload.t === "func") expect(log2Match.payload.name).toBe("log2");

      const lexSpace2 = lexLine("log 2");
      const logSpace2Match = reg.match(lexSpace2, lexSpace2.map(l => l.raw), 0);
      // "log 2" should match "log", length 1, not "log2"
      expect(logSpace2Match).not.toBeNull();
      expect(logSpace2Match?.length).toBe(1);
      if (logSpace2Match?.payload.t === "func") expect(logSpace2Match.payload.name).toBe("log");
    });

    it("returns null for no match", () => {
      const match = reg.match(lexLine("unknownword"), ["unknownword"], 0);
      expect(match).toBeNull();
    });
  });

  describe("currency and rates", () => {
    it("sets and updates conversion rates", () => {
      reg.setRates({ "EUR": 0.9, "GBP": "0.8" });
      expect(reg.rates.get("EUR")?.toNumber()).toBe(0.9);
      expect(reg.rates.get("GBP")?.toNumber()).toBe(0.8);
      // USD is implicitly set to 1
      expect(reg.rates.get("USD")?.toNumber()).toBe(1);
    });

    it("ignores negative rates", () => {
      reg.setRates({ "EUR": 0.9, "INVALID": -1 });
      expect(reg.rates.get("EUR")?.toNumber()).toBe(0.9);
      expect(reg.rates.has("INVALID")).toBe(false);
    });

    it("creates currency unit from rate", () => {
      const unit = reg.makeCurrencyUnitFromRate("EUR", new Decimal(0.9));
      expect(unit.id).toBe("EUR");
      expect(unit.dimension).toBe("currency");
      // 1 / 0.9 = 1.111...
      expect(unit.ratio.toNumber()).toBeCloseTo(1.1111, 4);
    });

    it("makes currency unit if rate exists", () => {
      reg.setRates({ "EUR": 0.9 });
      const unit = reg.makeCurrencyUnit("EUR");
      expect(unit).not.toBeNull();
      expect(unit?.id).toBe("EUR");

      const noUnit = reg.makeCurrencyUnit("JPY");
      expect(noUnit).toBeNull();
    });
  });

  describe("completions", () => {
    it("populates completions with expected categories", () => {
      expect(reg.completions.length).toBeGreaterThan(0);

      const types = new Set(reg.completions.map(c => c.type));
      expect(types.has("unit")).toBe(true);
      expect(types.has("currency")).toBe(true);
      expect(types.has("function")).toBe(true);
      expect(types.has("keyword")).toBe(true);
    });

    it("contains specific known completions", () => {
      const labels = reg.completions.map(c => c.label);
      expect(labels).toContain("USD");
      expect(labels).toContain("meter");
      expect(labels).toContain("sin");
      expect(labels).toContain("sum");
    });
  });
});
