import { describe, it, expect } from "vitest";
import { UNIT_DATA, SI_PREFIXES, DATA_SI_PREFIXES, IEC_PREFIXES, SCALE_DATA } from "./unitdata";
import { Decimal } from "./types";

describe("unitdata", () => {
  describe("UNIT_DATA", () => {
    it("contains valid entries with required properties", () => {
      expect(UNIT_DATA.length).toBeGreaterThan(0);

      UNIT_DATA.forEach((unit) => {
        expect(unit.id).toBeTypeOf("string");
        expect(unit.id.length).toBeGreaterThan(0);

        expect(unit.category).toBeTypeOf("string");
        expect(unit.category.length).toBeGreaterThan(0);

        expect(["length", "area", "volume", "weight", "temperature", "time", "angle", "data", "css"]).toContain(unit.dimension);

        expect(unit.ratio).toBeTypeOf("string");
        // Ensure ratio is parsable as a valid Decimal
        expect(() => new Decimal(unit.ratio)).not.toThrow();
        const ratioDec = new Decimal(unit.ratio);
        expect(ratioDec.isFinite()).toBe(true);
        expect(ratioDec.gt(0)).toBe(true);

        if (unit.offset !== undefined) {
          expect(unit.offset).toBeTypeOf("string");
          expect(() => new Decimal(unit.offset!)).not.toThrow();
          const offsetDec = new Decimal(unit.offset!);
          expect(offsetDec.isFinite()).toBe(true);
        }

        if (unit.prefixes !== undefined) {
          expect(["si", "data"]).toContain(unit.prefixes);
        }
      });
    });
  });

  describe("SI_PREFIXES", () => {
    it("contains valid SIPrefixes with correct properties", () => {
      expect(SI_PREFIXES.length).toBeGreaterThan(0);

      SI_PREFIXES.forEach((prefix) => {
        expect(prefix.id).toBeTypeOf("string");
        expect(prefix.id.length).toBeGreaterThan(0);

        expect(prefix.category).toBe("SIPrefixes");

        expect(prefix.mult).toBeTypeOf("string");
        expect(() => new Decimal(prefix.mult)).not.toThrow();
        const multDec = new Decimal(prefix.mult);
        expect(multDec.isFinite()).toBe(true);
        expect(multDec.gt(0)).toBe(true);
      });
    });
  });

  describe("DATA_SI_PREFIXES", () => {
    it("contains only prefixes with multiplier >= 1000", () => {
      expect(DATA_SI_PREFIXES.length).toBeGreaterThan(0);
      // All data SI prefixes must be a subset of SI_PREFIXES
      expect(DATA_SI_PREFIXES.every(p => SI_PREFIXES.includes(p))).toBe(true);

      DATA_SI_PREFIXES.forEach((prefix) => {
        const multDec = new Decimal(prefix.mult);
        expect(multDec.gte(1000)).toBe(true);
      });
    });

    it("correctly filters out prefixes with multiplier < 1000", () => {
      // Find one prefix < 1000 in SI_PREFIXES
      const smallPrefix = SI_PREFIXES.find(p => new Decimal(p.mult).lt(1000));
      expect(smallPrefix).toBeDefined();

      // Ensure it's not in DATA_SI_PREFIXES
      expect(DATA_SI_PREFIXES).not.toContain(smallPrefix);
    });
  });

  describe("IEC_PREFIXES", () => {
    it("contains valid IECPrefixes with correctly scaled multipliers", () => {
      expect(IEC_PREFIXES.length).toBeGreaterThan(0);

      IEC_PREFIXES.forEach((prefix) => {
        expect(prefix.id).toBeTypeOf("string");
        expect(prefix.id.length).toBeGreaterThan(0);

        expect(prefix.category).toBe("IECPrefixes");

        expect(prefix.mult).toBeTypeOf("string");
        expect(() => new Decimal(prefix.mult)).not.toThrow();
        const multDec = new Decimal(prefix.mult);
        expect(multDec.isFinite()).toBe(true);
        expect(multDec.gt(0)).toBe(true);
      });
    });
  });

  describe("SCALE_DATA", () => {
    it("contains correct scaling factors", () => {
      expect(Object.keys(SCALE_DATA)).toEqual(["thousand", "million", "billion", "trillion"]);

      expect(SCALE_DATA["thousand"]).toBe("1e3");
      expect(SCALE_DATA["million"]).toBe("1e6");
      expect(SCALE_DATA["billion"]).toBe("1e9");
      expect(SCALE_DATA["trillion"]).toBe("1e12");

      // Verify they are all parsable as Decimals
      for (const scaleVal of Object.values(SCALE_DATA)) {
        expect(() => new Decimal(scaleVal)).not.toThrow();
        const dec = new Decimal(scaleVal);
        expect(dec.isFinite()).toBe(true);
        expect(dec.gt(0)).toBe(true);
      }
    });
  });
});
