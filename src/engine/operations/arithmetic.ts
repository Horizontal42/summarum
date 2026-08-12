// Arithmetic operations for quantities, percents and dates
import type { Quantity, Unit, Value } from "../types";
import { Decimal, EvalError, qty } from "../types";
import type { Registry } from "../registry";
import { toBase, fromBase } from "./helpers";

export interface EvalCtx {
  reg: Registry;
}

/**
 * Adds two quantities with unit awareness
 */
export function addQ(a: Quantity, b: Quantity): Quantity {
  return numericAdd(a, b, 1);
}

/**
 * Subtracts two quantities with unit awareness
 */
export function subQ(a: Quantity, b: Quantity): Quantity {
  return numericAdd(a, b, -1);
}

/**
 * Core numeric addition/subtraction with unit conversion
 */
export function numericAdd(a: Quantity, b: Quantity, sign: 1 | -1): Quantity {
  if (a.unit && b.unit) {
    if (a.unit.dimension !== b.unit.dimension) {
      throw new EvalError("dimension mismatch");
    }
    if (a.unit.offset || b.unit.offset) {
      // temperatures: operate in the left unit's scale
      const bInA = convertQ(b, a.unit);
      return qty(sign === 1 ? a.value.add(bInA.value) : a.value.sub(bInA.value), a.unit);
    }
    const base = sign === 1 ? toBase(a).add(toBase(b)) : toBase(a).sub(toBase(b));
    return qty(fromBase(base, a.unit), a.unit);
  }
  const unit = a.unit ?? b.unit ?? null;
  return qty(sign === 1 ? a.value.add(b.value) : a.value.sub(b.value), unit);
}

/**
 * Converts quantity to target unit within same dimension
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

/**
 * Evaluates arithmetic operations on quantities
 */
export function evalQuantityArith(
  op: "plus" | "minus" | "mul" | "div" | "mod" | "pow",
  a: Quantity,
  b: Quantity,
  ctx: EvalCtx
): Value {
  switch (op) {
    case "plus":
      return numericAdd(a, b, 1);
    case "minus":
      return numericAdd(a, b, -1);
    case "mul": {
      if (a.unit && b.unit) {
        const da = a.unit.dimension;
        const db = b.unit.dimension;
        const baseProduct = toBase(a).mul(toBase(b));
        let targetId: string | null = null;
        if (da === "length" && db === "length") {
          targetId = `sq:${a.unit.id}`;
        } else if (da === "length" && db === "area") {
          targetId = `cb:${a.unit.id}`;
        } else if (da === "area" && db === "length") {
          targetId = `cb:${b.unit.id}`;
        }
        if (targetId) {
          const u = ctx.reg.unitsById.get(targetId);
          if (u) {
            return qty(baseProduct.div(u.ratio), u);
          }
        }
        // same dimension: "2 kg * 500 g" scales in the left unit, not 2*500
        if (da === db) {
          return qty(a.value.mul(convertQ(b, a.unit).value), a.unit);
        }
        return qty(a.value.mul(b.value), a.unit);
      }
      return qty(a.value.mul(b.value), a.unit ?? b.unit ?? null);
    }
    case "div": {
      if (b.value.isZero()) {
        throw new EvalError("division by zero");
      }
      if (a.unit && b.unit && a.unit.dimension === b.unit.dimension) {
        return qty(toBase(a).div(toBase(b)));
      }
      return qty(a.value.div(b.value), a.unit ?? null);
    }
    case "mod": {
      if (b.value.isZero()) {
        throw new EvalError("mod zero");
      }
      return qty(a.value.mod(b.value), a.unit ?? null);
    }
    case "pow": {
      const result = a.value.pow(b.value);
      if (a.unit?.dimension === "length" && !b.unit) {
        const id =
          b.value.eq(2) ? `sq:${a.unit.id}` : b.value.eq(3) ? `cb:${a.unit.id}` : null;
        const u = id ? ctx.reg.unitsById.get(id) : null;
        if (u) {
          return qty(result, u);
        }
      }
      return qty(
        result,
        b.unit ? null : a.unit && b.value.eq(1) ? a.unit : null
      );
    }
  }
}

/**
 * Evaluates arithmetic operations on percents
 */
export function evalPercentArith(
  op: "plus" | "minus" | "mul" | "div" | "mod" | "pow",
  l: Value,
  r: Value
): Value {
  if (l.kind === "percent" && r.kind === "percent") {
    switch (op) {
      case "plus":
        return pct(l.value.add(r.value));
      case "minus":
        return pct(l.value.sub(r.value));
      case "mul":
        return pct(l.value.mul(r.value).div(100));
      case "div":
        return qty(l.value.div(r.value));
      default:
        throw new EvalError("bad percent op");
    }
  }
  const q = (l.kind === "quantity" ? l : r) as Quantity;
  const p = (l.kind === "percent" ? l : r as { kind: "percent"; value: Decimal }).value;
  switch (op) {
    case "plus":
      return qty(q.value.mul(new Decimal(1).add(p.div(100))), q.unit);
    case "minus":
      if (l.kind === "percent") {
        throw new EvalError("percent minus number");
      }
      return qty(q.value.mul(new Decimal(1).sub(p.div(100))), q.unit);
    case "mul":
      return qty(q.value.mul(p).div(100), q.unit);
    case "div":
      if (l.kind === "percent") {
        throw new EvalError("percent div number");
      }
      return qty(q.value.div(p.div(100)), q.unit);
    case "pow":
      // which side the percent is on matters: 50% ^ 2 = 0.25, 2 ^ 50% = √2
      return l.kind === "percent"
        ? qty(p.div(100).pow(q.value))
        : qty(q.value.pow(p.div(100)), q.unit);
    default:
      throw new EvalError("bad percent op");
  }
}

function pct(value: Decimal) {
  return { kind: "percent" as const, value, repr: "decimal" as const };
}
