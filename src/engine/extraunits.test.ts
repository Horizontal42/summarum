import { describe, it, expect } from "vitest";
import { EXTRA_UNITS, CRYPTO } from "./extraunits";

describe("EXTRA_UNITS", () => {
  it("should be defined and not empty", () => {
    expect(EXTRA_UNITS).toBeDefined();
    expect(Array.isArray(EXTRA_UNITS)).toBe(true);
    expect(EXTRA_UNITS.length).toBeGreaterThan(0);
  });

  it("should have correct properties for each extra unit", () => {
    const validDimensions = ["speed", "pressure", "energy", "power", "frequency", "fuel"];

    EXTRA_UNITS.forEach((unit) => {
      // Required string properties
      expect(typeof unit.id).toBe("string");
      expect(unit.id.length).toBeGreaterThan(0);

      expect(validDimensions).toContain(unit.dimension);

      expect(typeof unit.ratio).toBe("string");
      // Ratio should be parseable as a valid number
      const parsedRatio = Number(unit.ratio);
      expect(Number.isNaN(parsedRatio)).toBe(false);
      expect(parsedRatio).toBeGreaterThan(0);

      expect(typeof unit.format).toBe("string");
      expect(unit.format.length).toBeGreaterThan(0);

      expect(typeof unit.phrases).toBe("string");
      expect(unit.phrases.length).toBeGreaterThan(0);

      // Optional properties
      if ("reciprocal" in unit) {
        expect(typeof unit.reciprocal).toBe("boolean");
      }

      if ("symbols" in unit && unit.symbols !== undefined) {
        expect(typeof unit.symbols).toBe("string");
        expect(unit.symbols.length).toBeGreaterThan(0);
      }
    });
  });
});

describe("CRYPTO", () => {
  it("should be defined and not empty", () => {
    expect(CRYPTO).toBeDefined();
    expect(Array.isArray(CRYPTO)).toBe(true);
    expect(CRYPTO.length).toBeGreaterThan(0);
  });

  it("should have correct properties for each crypto definition", () => {
    CRYPTO.forEach((crypto) => {
      // Required string properties
      expect(typeof crypto.code).toBe("string");
      expect(crypto.code.length).toBeGreaterThan(0);

      expect(typeof crypto.geckoId).toBe("string");
      expect(crypto.geckoId.length).toBeGreaterThan(0);

      expect(typeof crypto.phrases).toBe("string");
      expect(crypto.phrases.length).toBeGreaterThan(0);

      // Required number property
      expect(typeof crypto.snapshotUsd).toBe("number");
      expect(crypto.snapshotUsd).toBeGreaterThan(0);
      expect(Number.isNaN(crypto.snapshotUsd)).toBe(false);
    });
  });
});
