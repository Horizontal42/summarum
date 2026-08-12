// Helper functions for evaluator operations
import type { Quantity, Unit , Decimal} from "../types";
import { EvalError } from "../types";

/**
 * Converts quantity to base dimension units
 */
export function toBase(q: Quantity): Decimal {
  if (!q.unit) {
    return q.value;
  }
  if (q.unit.reciprocal) {
    if (q.value.isZero()) {
      throw new EvalError("division by zero");
    }
    return q.unit.ratio.div(q.value); // mpg -> L/100km
  }
  let b = q.value.mul(q.unit.ratio);
  if (q.unit.offset) {
    b = b.add(q.unit.offset);
  }
  return b;
}

/**
 * Converts from base dimension units to target unit
 */
export function fromBase(base: Decimal, unit: Unit): Decimal {
  if (unit.reciprocal) {
    if (base.isZero()) {
      throw new EvalError("division by zero");
    }
    return unit.ratio.div(base);
  }
  let v = base;
  if (unit.offset) {
    v = v.sub(unit.offset);
  }
  return v.div(unit.ratio);
}

/**
 * Attaches unit to a value with conversion if needed
 */
export function attachUnit(v: any, unit: Unit): any {
  if (v.kind === "quantity") {
    if (v.unit && v.unit.dimension === unit.dimension) {
      return convertQ(v, unit);
    }
    if (v.unit) {
      throw new EvalError("unit mismatch");
    }
    return { ...v, unit, repr: "decimal" };
  }
  throw new EvalError("cannot attach unit");
}

/**
 * Converts quantity between units of same dimension
 */
export function convertQ(q: Quantity, unit: Unit): Quantity {
  if (!q.unit) {
    return { ...q, unit };
  }
  if (q.unit.dimension !== unit.dimension) {
    throw new EvalError("dimension mismatch");
  }
  return qty(fromBase(toBase(q), unit), unit);
}

function qty(value: Decimal, unit: Unit | null, repr?: "decimal" | "plain" | "fraction") {
  return { kind: "quantity" as const, value, unit, repr: repr ?? "decimal" };
}
