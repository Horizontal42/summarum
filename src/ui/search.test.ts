import { describe, it, expect } from "vitest";
import { SumEngine } from "../engine";
import { parseResultQuery } from "./search";
import Decimal from "decimal.js";

describe("parseResultQuery", () => {
  const engine = new SumEngine();

  it("parses '>=' operator correctly", () => {
    const res = parseResultQuery(engine, ">= 100");
    expect(res).not.toBeNull();
    expect(res?.op).toBe(">=");
    expect(res?.threshold.kind).toBe("quantity");
    if (res?.threshold.kind === "quantity") {
      expect(res.threshold.value.eq(new Decimal(100))).toBe(true);
    }
  });

  it("parses '<=' operator correctly", () => {
    const res = parseResultQuery(engine, "<= 50");
    expect(res).not.toBeNull();
    expect(res?.op).toBe("<=");
    expect(res?.threshold.kind).toBe("quantity");
    if (res?.threshold.kind === "quantity") {
      expect(res.threshold.value.eq(new Decimal(50))).toBe(true);
    }
  });

  it("parses '>' operator correctly", () => {
    const res = parseResultQuery(engine, "> 0");
    expect(res).not.toBeNull();
    expect(res?.op).toBe(">");
    expect(res?.threshold.kind).toBe("quantity");
    if (res?.threshold.kind === "quantity") {
      expect(res.threshold.value.eq(new Decimal(0))).toBe(true);
    }
  });

  it("parses '<' operator correctly", () => {
    const res = parseResultQuery(engine, "< -10");
    expect(res).not.toBeNull();
    expect(res?.op).toBe("<");
    expect(res?.threshold.kind).toBe("quantity");
    if (res?.threshold.kind === "quantity") {
      expect(res.threshold.value.eq(new Decimal(-10))).toBe(true);
    }
  });

  it("parses '=' operator correctly", () => {
    const res = parseResultQuery(engine, "= 42.5");
    expect(res).not.toBeNull();
    expect(res?.op).toBe("=");
    expect(res?.threshold.kind).toBe("quantity");
    if (res?.threshold.kind === "quantity") {
      expect(res.threshold.value.eq(new Decimal(42.5))).toBe(true);
    }
  });

  it("parses '~' operator correctly", () => {
    const res = parseResultQuery(engine, "~ 3.14");
    expect(res).not.toBeNull();
    expect(res?.op).toBe("~");
    expect(res?.threshold.kind).toBe("quantity");
    if (res?.threshold.kind === "quantity") {
      expect(res.threshold.value.eq(new Decimal(3.14))).toBe(true);
    }
  });

  it("handles whitespace correctly", () => {
    const res = parseResultQuery(engine, "   >=    200   ");
    expect(res).not.toBeNull();
    expect(res?.op).toBe(">=");
    expect(res?.threshold.kind).toBe("quantity");
    if (res?.threshold.kind === "quantity") {
      expect(res.threshold.value.eq(new Decimal(200))).toBe(true);
    }
  });

  it("returns null for invalid operator", () => {
    const res = parseResultQuery(engine, "!= 100");
    expect(res).toBeNull();
  });

  it("returns null for invalid value string", () => {
    // "abc" cannot be evaluated to a quantity
    const res = parseResultQuery(engine, ">= abc");
    expect(res).toBeNull();
  });

  it("returns null for empty string", () => {
    const res = parseResultQuery(engine, "");
    expect(res).toBeNull();
  });

  it("returns null when no expression matches after operator", () => {
    const res = parseResultQuery(engine, ">=");
    expect(res).toBeNull();
  });
});
