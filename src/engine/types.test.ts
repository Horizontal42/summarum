import { describe, it, expect } from "vitest";
import { qty, pct, Decimal } from "./types";

describe("types", () => {
  describe("qty", () => {
    it("creates a quantity with default arguments", () => {
      const result = qty(42);
      expect(result.kind).toBe("quantity");
      expect(result.value).toBeInstanceOf(Decimal);
      expect(result.value.toNumber()).toBe(42);
      expect(result.unit).toBeNull();
      expect(result.repr).toBe("decimal");
    });

    it("creates a quantity with all arguments provided", () => {
      const mockUnit = { id: "meter", dimension: "length", ratio: new Decimal(1), format: "m" } as any;
      const result = qty("3.14", mockUnit, "hex");
      expect(result.kind).toBe("quantity");
      expect(result.value).toBeInstanceOf(Decimal);
      expect(result.value.toString()).toBe("3.14");
      expect(result.unit).toBe(mockUnit);
      expect(result.repr).toBe("hex");
    });
  });

  describe("pct", () => {
    it("creates a percent value from number", () => {
      const result = pct(25);
      expect(result.kind).toBe("percent");
      expect(result.value).toBeInstanceOf(Decimal);
      expect(result.value.toNumber()).toBe(25);
    });

    it("creates a percent value from string", () => {
      const result = pct("12.5");
      expect(result.kind).toBe("percent");
      expect(result.value).toBeInstanceOf(Decimal);
      expect(result.value.toString()).toBe("12.5");
    });
  });
});
