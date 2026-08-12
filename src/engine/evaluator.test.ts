import { describe, it, expect } from "vitest";
import { toBase, fromBase, convertQ, attachUnit } from "./evaluator";
import { qty, pct, EvalError, Decimal } from "./types";
import { buildRegistry } from "./registry";

const reg = buildRegistry();
const getUnit = (id: string) => {
  const u = reg.unitsById.get(id);
  if (!u) {throw new Error(`unit ${id} not found`);}
  return u;
};

describe("quantity conversion", () => {
  it("toBase works", () => {
    // 1 km = 1000 m
    const km = getUnit("kilo:meter");
    const res1 = toBase(qty(2, km));
    expect(res1.toNumber()).toBe(2000);

    // 0 C = 273.15 K
    const c = getUnit("celsius");
    const res2 = toBase(qty(0, c));
    expect(res2.toNumber()).toBe(273.15);

    // 10 mpg
    const mpg = getUnit("mpg");
    const res3 = toBase(qty(10, mpg));
    expect(res3.toNumber()).toBeCloseTo(23.5215, 4);

    // error on zero for reciprocal
    expect(() => toBase(qty(0, mpg))).toThrow(EvalError);
  });

  it("fromBase works", () => {
    const km = getUnit("kilo:meter");
    const res1 = fromBase(new Decimal(2000), km);
    expect(res1.toNumber()).toBe(2);

    const c = getUnit("celsius");
    const res2 = fromBase(new Decimal(273.15), c);
    expect(res2.toNumber()).toBe(0);

    const mpg = getUnit("mpg");
    const res3 = fromBase(new Decimal(23.5215), mpg);
    expect(res3.toNumber()).toBeCloseTo(10, 4);

    expect(() => fromBase(new Decimal(0), mpg)).toThrow(EvalError);
  });

  it("convertQ works", () => {
    const m = getUnit("meter");
    const km = getUnit("kilo:meter");

    // 2000m -> km
    const q1 = convertQ(qty(2000, m), km);
    expect(q1.value.toNumber()).toBe(2);
    expect(q1.unit?.id).toBe("kilo:meter");

    // c -> f
    const c = getUnit("celsius");
    const f = getUnit("fahrenheit");
    const q2 = convertQ(qty(0, c), f);
    expect(q2.value.toNumber()).toBeCloseTo(32);

    // fail on mismatched dimensions
    const kg = getUnit("kilo:gram");
    expect(() => convertQ(qty(1, m), kg)).toThrow(EvalError);
  });

  it("attachUnit works", () => {
    const m = getUnit("meter");
    const km = getUnit("kilo:meter");
    const kg = getUnit("kilo:gram");

    // attaching to dimensionless
    const r1 = attachUnit(qty(2), m);
    expect(r1).toMatchObject({ kind: "quantity", unit: { id: "meter" } });

    // attaching matching dimension does conversion
    const r2 = attachUnit(qty(2000, m), km);
    expect((r2 as any).value.toNumber()).toBe(2);
    expect((r2 as any).unit?.id).toBe("kilo:meter");

    // attaching mismatched dimension throws
    expect(() => attachUnit(qty(1, m), kg)).toThrow(EvalError);

    // attaching to non-quantity throws
    expect(() => attachUnit(pct(50), m)).toThrow(EvalError);
  });
});
