// Walks the AST with the document context (variables, line results for
// sum/avg/prev) and produces unit-aware values.
import { Decimal, EvalError, Quantity, Unit, Value, qty, pct } from "./types";
import { Node, ConvTarget } from "./parser";
import { Registry } from "./registry";
import { resolveZone, startOfToday, addToDate, isCalendarUnit } from "./datetime";

export interface LineCtx {
  /** values of lines above (null = no result) */
  lineValues: (Value | null)[];
  /** per-line flags for block boundaries */
  lineKinds: ("empty" | "header" | "normal")[];
  index: number;
  /** raw line text — used to seed random() deterministically */
  lineText: string;
}

export interface EvalCtx {
  reg: Registry;
  vars: Map<string, Value>;
  line: LineCtx;
  /** date → { code → rate-per-usd } */
  historicalRates?: Map<string, Map<string, number>>;
}

const PI = new Decimal("3.14159265358979323846264338327950288419716939937510");
const E = new Decimal("2.71828182845904523536028747135266249775724709369995");

export function evaluate(node: Node, ctx: EvalCtx): Value {
  switch (node.k) {
    case "num":
      return qty(node.v, null, node.repr);
    case "const":
      switch (node.name) {
        case "pi": return qty(PI);
        case "e": return qty(E);
        case "half": return qty(new Decimal("0.5"));
        case "onehalf": return qty(new Decimal("1.5"));
      }
    case "var": {
      const v = ctx.vars.get(node.name);
      if (!v) throw new EvalError(`unknown variable ${node.name}`);
      return v;
    }
    case "date":
      return evalDateWord(node.word);
    case "datelit":
      return { kind: "date", ms: node.ms, hasTime: false };
    case "unknown": {
      const xv = ctx.vars.get("__x__");
      if (!xv) throw new EvalError("? used outside goal seek");
      return xv;
    }
    case "goalseek":
      return evalGoalSeek(node.lhs, node.rhs, ctx);
    case "agg":
      return evalAgg(node.name, ctx);
    case "neg": {
      const v = evaluate(node.x, ctx);
      if (v.kind === "quantity") return { ...v, value: v.value.neg() };
      if (v.kind === "percent") return pct(v.value.neg());
      throw new EvalError("cannot negate a date");
    }
    case "pct": {
      const v = evaluate(node.x, ctx);
      if (v.kind === "quantity" && !v.unit) return pct(v.value);
      if (v.kind === "percent") return v;
      throw new EvalError("% needs a plain number");
    }
    case "fact": {
      const v = asScalar(evaluate(node.x, ctx));
      return qty(factorial(v));
    }
    case "unit": {
      const v = evaluate(node.x, ctx);
      return attachUnit(v, node.unit);
    }
    case "curr": {
      const unit = ctx.reg.makeCurrencyUnit(node.code);
      if (!unit) throw new EvalError(`no rate for ${node.code}`);
      const v = evaluate(node.x, ctx);
      return attachUnit(v, unit);
    }
    case "scale": {
      const v = evaluate(node.x, ctx);
      if (v.kind === "quantity") return { ...v, value: v.value.mul(node.mult) };
      if (v.kind === "percent") return pct(v.value.mul(node.mult));
      throw new EvalError("cannot scale a date");
    }
    case "bin":
      return evalBin(node.op, evaluate(node.l, ctx), evaluate(node.r, ctx), ctx);
    case "bit":
      return evalBit(node.op, evaluate(node.l, ctx), evaluate(node.r, ctx));
    case "pctop":
      return evalPctOp(node.op, evaluate(node.l, ctx), evaluate(node.r, ctx));
    case "conv":
      return evalConv(evaluate(node.x, ctx), node.target, ctx);
    case "call":
      return evalCall(node.name, node.args.map((a) => evaluate(a, ctx)), ctx);
    case "seq": {
      let acc: Value | null = null;
      for (const item of node.items) {
        let v: Value;
        try {
          v = evaluate(item, ctx);
        } catch {
          continue;
        }
        if (
          acc?.kind === "quantity" && v.kind === "quantity" &&
          acc.unit && v.unit && acc.unit.dimension === v.unit.dimension &&
          acc.unit.dimension !== "scalar"
        ) {
          // "2 hours 30 min", "5 ft 4 in" — adjacent same-dimension quantities add up
          acc = addQ(acc, v);
        } else {
          acc = v;
        }
      }
      if (!acc) throw new EvalError("empty expression");
      return acc;
    }
  }
}

// ---------- helpers

function asScalar(v: Value): Decimal {
  if (v.kind === "quantity") return v.value;
  if (v.kind === "percent") return v.value.div(100);
  throw new EvalError("expected a number");
}

function attachUnit(v: Value, unit: Unit): Value {
  if (v.kind === "quantity") {
    if (v.unit && v.unit.dimension === unit.dimension) return convertQ(v, unit);
    if (v.unit) throw new EvalError("unit mismatch");
    return { ...v, unit, repr: "decimal" };
  }
  throw new EvalError("cannot attach unit");
}

/** value of q in dimension-base units */
export function toBase(q: Quantity): Decimal {
  if (!q.unit) return q.value;
  if (q.unit.reciprocal) {
    if (q.value.isZero()) throw new EvalError("division by zero");
    return q.unit.ratio.div(q.value); // mpg -> L/100km
  }
  let b = q.value.mul(q.unit.ratio);
  if (q.unit.offset) b = b.add(q.unit.offset);
  return b;
}

export function fromBase(base: Decimal, unit: Unit): Decimal {
  if (unit.reciprocal) {
    if (base.isZero()) throw new EvalError("division by zero");
    return unit.ratio.div(base);
  }
  let v = base;
  if (unit.offset) v = v.sub(unit.offset);
  return v.div(unit.ratio);
}

export function convertQ(q: Quantity, unit: Unit): Quantity {
  if (!q.unit) return { ...q, unit };
  if (q.unit.dimension !== unit.dimension) throw new EvalError("dimension mismatch");
  return qty(fromBase(toBase(q), unit), unit);
}

function addQ(a: Quantity, b: Quantity): Quantity {
  return numericAdd(a, b, 1);
}

function numericAdd(a: Quantity, b: Quantity, sign: 1 | -1): Quantity {
  if (a.unit && b.unit) {
    if (a.unit.dimension !== b.unit.dimension) throw new EvalError("dimension mismatch");
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

function evalBin(op: "plus" | "minus" | "mul" | "div" | "mod" | "pow", l: Value, r: Value, ctx: EvalCtx): Value {
  // ---- dates
  if (l.kind === "date" || r.kind === "date") return evalDateArith(op, l, r);

  // ---- percent combinations
  if (l.kind === "percent" || r.kind === "percent") {
    if (l.kind === "percent" && r.kind === "percent") {
      switch (op) {
        case "plus": return pct(l.value.add(r.value));
        case "minus": return pct(l.value.sub(r.value));
        case "mul": return pct(l.value.mul(r.value).div(100));
        case "div": return qty(l.value.div(r.value));
        default: throw new EvalError("bad percent op");
      }
    }
    const q = (l.kind === "quantity" ? l : r) as Quantity;
    const p = (l.kind === "percent" ? l : r as { kind: "percent"; value: Decimal }).value;
    switch (op) {
      case "plus": return qty(q.value.mul(new Decimal(1).add(p.div(100))), q.unit);
      case "minus":
        if (l.kind === "percent") throw new EvalError("percent minus number");
        return qty(q.value.mul(new Decimal(1).sub(p.div(100))), q.unit);
      case "mul": return qty(q.value.mul(p).div(100), q.unit);
      case "div":
        if (l.kind === "percent") throw new EvalError("percent div number");
        return qty(q.value.div(p.div(100)), q.unit);
      case "pow":
        // which side the percent is on matters: 50% ^ 2 = 0.25, 2 ^ 50% = √2
        return l.kind === "percent"
          ? qty(p.div(100).pow(q.value))
          : qty(q.value.pow(p.div(100)), q.unit);
      default: throw new EvalError("bad percent op");
    }
  }

  const a = l as Quantity;
  const b = r as Quantity;
  switch (op) {
    case "plus": return numericAdd(a, b, 1);
    case "minus": return numericAdd(a, b, -1);
    case "mul": {
      if (a.unit && b.unit) {
        const da = a.unit.dimension;
        const db = b.unit.dimension;
        const baseProduct = toBase(a).mul(toBase(b));
        let targetId: string | null = null;
        if (da === "length" && db === "length") targetId = `sq:${a.unit.id}`;
        else if (da === "length" && db === "area") targetId = `cb:${a.unit.id}`;
        else if (da === "area" && db === "length") targetId = `cb:${b.unit.id}`;
        if (targetId) {
          const u = ctx.reg.unitsById.get(targetId);
          if (u) return qty(baseProduct.div(u.ratio), u);
        }
        return qty(a.value.mul(b.value), a.unit);
      }
      return qty(a.value.mul(b.value), a.unit ?? b.unit ?? null);
    }
    case "div": {
      if (b.value.isZero()) throw new EvalError("division by zero");
      if (a.unit && b.unit && a.unit.dimension === b.unit.dimension) {
        return qty(toBase(a).div(toBase(b)));
      }
      return qty(a.value.div(b.value), a.unit ?? null);
    }
    case "mod": {
      if (b.value.isZero()) throw new EvalError("mod zero");
      return qty(a.value.mod(b.value), a.unit ?? null);
    }
    case "pow": {
      const result = a.value.pow(b.value);
      if (a.unit?.dimension === "length" && !b.unit) {
        const id = b.value.eq(2) ? `sq:${a.unit.id}` : b.value.eq(3) ? `cb:${a.unit.id}` : null;
        const u = id ? ctx.reg.unitsById.get(id) : null;
        if (u) return qty(result, u);
      }
      return qty(result, b.unit ? null : a.unit && b.value.eq(1) ? a.unit : null);
    }
  }
}

function evalBit(op: string, l: Value, r: Value): Value {
  if (l.kind !== "quantity" || r.kind !== "quantity") throw new EvalError("bitwise needs integers");
  if (!l.value.isFinite() || !r.value.isFinite()) throw new EvalError("bitwise needs finite integers");
  const a = BigInt(l.value.toDecimalPlaces(0).toFixed(0));
  const b = BigInt(r.value.toDecimalPlaces(0).toFixed(0));
  if ((op === "shl" || op === "shr") && (b < 0n || b > 256n)) throw new EvalError("bad shift");
  let out: bigint;
  switch (op) {
    case "band": out = a & b; break;
    case "bor": out = a | b; break;
    case "bxor": out = a ^ b; break;
    case "shl": out = a << b; break;
    case "shr": out = a >> b; break;
    default: throw new EvalError("bad bit op");
  }
  const repr = l.repr !== "decimal" ? l.repr : r.repr;
  return qty(new Decimal(out.toString()), null, repr);
}

function evalPctOp(op: string, l: Value, r: Value): Value {
  const rq = r.kind === "quantity" ? r : null;
  const rv = r.kind === "percent" ? r.value.div(100) : rq ? rq.value : null;
  if (rv === null) throw new EvalError("bad operand");
  const unit = rq?.unit ?? null;

  if (op === "of" || op === "off" || op === "on") {
    const p = l.kind === "percent" ? l.value : asScalar(l).mul(100);
    const factor =
      op === "of" ? p.div(100)
      : op === "off" ? new Decimal(1).sub(p.div(100))
      : new Decimal(1).add(p.div(100));
    // a percent of a percent stays a percent: 50% of 50% = 25%
    if (r.kind === "percent") return pct(r.value.mul(factor));
    return qty(rv.mul(factor), unit);
  }
  if (op === "as_pct_of" || op === "as_pct_off" || op === "as_pct_on") {
    const lv = l.kind === "quantity" ? l.value : asScalar(l);
    if (rv.isZero()) throw new EvalError("division by zero");
    switch (op) {
      case "as_pct_of": return pct(lv.div(rv).mul(100));
      case "as_pct_off": return pct(new Decimal(1).sub(lv.div(rv)).mul(100));
      case "as_pct_on": return pct(lv.div(rv).sub(1).mul(100));
    }
  }
  // "20% of what is 30"
  const p = l.kind === "percent" ? l.value : asScalar(l).mul(100);
  switch (op) {
    case "of_what_is": return qty(rv.div(p.div(100)), unit);
    case "off_what_is": {
      const d = new Decimal(1).sub(p.div(100));
      if (d.isZero()) throw new EvalError("division by zero");
      return qty(rv.div(d), unit);
    }
    case "on_what_is": return qty(rv.div(new Decimal(1).add(p.div(100))), unit);
  }
  throw new EvalError(`bad percent op ${op}`);
}

function evalConv(v: Value, target: ConvTarget, ctx: EvalCtx): Value {
  switch (target.type) {
    case "unit": {
      if (v.kind === "percent") return pct(v.value); // "x in %" — keep
      if (v.kind !== "quantity") throw new EvalError("cannot convert date to unit");
      if (!v.unit) return qty(v.value, target.unit);
      return convertQ(v, target.unit);
    }
    case "currency": {
      let unit;
      if (target.onDate) {
        const dateRates = ctx.historicalRates?.get(target.onDate);
        const rate = dateRates?.get(target.code);
        if (rate === undefined) throw new EvalError(`no historical rate for ${target.code} on ${target.onDate}`);
        unit = ctx.reg.makeCurrencyUnitFromRate(target.code, new Decimal(rate));
      } else {
        unit = ctx.reg.makeCurrencyUnit(target.code);
        if (!unit) throw new EvalError(`no rate for ${target.code}`);
      }
      if (v.kind !== "quantity") throw new EvalError("cannot convert to currency");
      if (!v.unit) return qty(v.value, unit);
      return convertQ(v, unit);
    }
    case "repr": {
      if (v.kind !== "quantity") throw new EvalError("bad repr conversion");
      return { ...v, repr: target.repr };
    }
    case "scale": {
      if (v.kind !== "quantity") throw new EvalError("bad scale conversion");
      return qty(v.value.div(target.mult), v.unit); // formatter shows plain number
    }
    case "tz": {
      const zone = resolveZone(target.words);
      if (!zone) throw new EvalError("unknown timezone");
      if (v.kind !== "date") throw new EvalError("timezone needs a time");
      return { ...v, timeZone: zone };
    }
    case "unix": {
      if (v.kind === "date") return qty(new Decimal(v.ms).div(1000).floor(), null, "plain");
      throw new EvalError("unix needs a date");
    }
    case "todate": {
      if (v.kind !== "quantity" || v.unit) throw new EvalError("date needs a plain number");
      // heuristics: > 1e12 means milliseconds, else seconds
      const ms = v.value.gt(1e12) ? v.value.toNumber() : v.value.mul(1000).toNumber();
      return { kind: "date", ms, hasTime: true };
    }
  }
}

function evalDateWord(word: string): Value {
  switch (word) {
    case "today": return { kind: "date", ms: startOfToday(), hasTime: false };
    case "tomorrow": return { kind: "date", ms: startOfToday() + 86400_000, hasTime: false };
    case "yesterday": return { kind: "date", ms: startOfToday() - 86400_000, hasTime: false };
    case "now": return { kind: "date", ms: Date.now(), hasTime: true };
    case "time": case "local": return { kind: "date", ms: Date.now(), hasTime: true, timeOnly: true };
    default: throw new EvalError(`bad date word ${word}`);
  }
}

function evalDateArith(op: string, l: Value, r: Value): Value {
  if (l.kind === "date" && r.kind === "date") {
    if (op !== "minus") throw new EvalError("dates only subtract");
    // midnight-to-midnight differences count calendar days (robust across DST)
    const days = !l.hasTime && !r.hasTime
      ? new Decimal(Math.round((l.ms - r.ms) / 86400_000))
      : new Decimal(l.ms - r.ms).div(86400_000);
    return qty(days, { id: "day", dimension: "time", ratio: new Decimal(86400), format: "day" });
  }
  const date = (l.kind === "date" ? l : r) as Extract<Value, { kind: "date" }>;
  const span = l.kind === "date" ? r : l;
  if (span.kind !== "quantity" || span.unit?.dimension !== "time") {
    throw new EvalError("date arithmetic needs a time span");
  }
  if (op !== "plus" && op !== "minus") throw new EvalError("bad date op");
  if (op === "minus" && l.kind !== "date") throw new EvalError("cannot subtract date from number");
  const amount = span.value.toNumber() * (op === "minus" ? -1 : 1);
  let ms: number;
  let hasTime = date.hasTime;
  if (isCalendarUnit(span.unit.id, amount)) {
    ms = addToDate(date.ms, amount, span.unit.id);
  } else {
    const seconds = span.value.mul(span.unit.ratio);
    ms = date.ms + seconds.mul(1000).toNumber() * (op === "minus" ? -1 : 1);
    // "today + 2 hours" must show the time part to be visible at all
    if (!seconds.mod(86400).isZero()) hasTime = true;
  }
  return { ...date, ms, hasTime };
}

function evalGoalSeek(lhsNode: Node, rhsNode: Node, ctx: EvalCtx): Value {
  const evalF = (x: Decimal): Decimal => {
    const vars = new Map(ctx.vars);
    vars.set("__x__", qty(x));
    const innerCtx: EvalCtx = { ...ctx, vars };
    const lv = evaluate(lhsNode, innerCtx);
    const rv = evaluate(rhsNode, innerCtx);
    const toD = (v: Value) => v.kind === "quantity" ? toBase(v) : new Decimal(0);
    return toD(lv).minus(toD(rv));
  };

  // Linear probe: f(0) and f(1) give slope → exact root for linear expressions
  const f0 = evalF(new Decimal(0));
  const f1 = evalF(new Decimal(1));
  const slope = f1.minus(f0);
  if (!slope.isZero()) {
    const root = f0.neg().div(slope);
    if (evalF(root).abs().lt(new Decimal("1e-9"))) return qty(root);
  }

  // Bisection fallback for nonlinear cases
  let lo = new Decimal(-1e9);
  let hi = new Decimal(1e9);
  let flo = evalF(lo);
  let fhi = evalF(hi);
  if (flo.mul(fhi).gt(0)) throw new EvalError("no solution");
  for (let i = 0; i < 100; i++) {
    const mid = lo.plus(hi).div(2);
    if (hi.minus(lo).abs().lt(new Decimal("1e-10"))) return qty(mid);
    const fm = evalF(mid);
    if (flo.mul(fm).lte(0)) { hi = mid; fhi = fm; }
    else { lo = mid; flo = fm; }
  }
  return qty(lo.plus(hi).div(2));
}

function evalAgg(name: "sum" | "avg" | "prev" | "count" | "min" | "max" | "product" | "chart", ctx: EvalCtx): Value {
  const { lineValues, lineKinds, index } = ctx.line;
  if (name === "prev") {
    for (let i = index - 1; i >= 0; i--) {
      const v = lineValues[i];
      if (v) return v;
    }
    throw new EvalError("no previous result");
  }
  const block: Quantity[] = [];
  for (let i = index - 1; i >= 0; i--) {
    if (lineKinds[i] === "empty" || lineKinds[i] === "header") {
      if (block.length > 0) break;
      if (lineKinds[i] === "header") break;
      continue; // skip empties directly above until the block starts
    }
    const v = lineValues[i];
    if (v?.kind === "quantity") block.push(v);
  }
  if (block.length === 0) throw new EvalError("nothing to aggregate");
  block.reverse();

  if (name === "count") return qty(new Decimal(block.length));

  if (name === "chart") {
    const refDim = block[0].unit?.dimension ?? null;
    const compatible = block.filter((q) => (q.unit?.dimension ?? null) === refDim);
    if (compatible.length < 2) throw new EvalError("need at least 2 values for chart");
    return {
      kind: "chart",
      points: compatible.map((q) => toBase(q)),
      unitLabel: block[0].unit?.format ?? null,
    };
  }

  if (name === "min" || name === "max") {
    const refDim = block[0].unit?.dimension ?? null;
    const compatible = block.filter((q) => (q.unit?.dimension ?? null) === refDim);
    return compatible.reduce((best, q) =>
      (name === "min" ? toBase(q).lt(toBase(best)) : toBase(q).gt(toBase(best))) ? q : best
    );
  }

  if (name === "product") {
    return qty(block.reduce((acc, q) => acc.mul(q.value), new Decimal(1)));
  }

  let acc = block[0];
  let counted = 1;
  for (let i = 1; i < block.length; i++) {
    const item = block[i];
    try {
      acc = numericAdd(acc, item, 1);
      counted++;
    } catch {
      // skip lines with incompatible dimensions
    }
  }
  if (name === "avg") return qty(acc.value.div(counted), acc.unit);
  return acc;
}

function evalCall(name: string, args: Value[], ctx: EvalCtx): Value {
  const custom = ctx.reg.customFuncs.get(name);
  if (custom) return custom(args);

  const x = args[0];
  if (!x) throw new EvalError(`${name} needs an argument`);

  // trig works on angles: degrees convert to radians
  const angleArg = (): Decimal => {
    if (x.kind === "quantity" && x.unit?.dimension === "angle") {
      return x.value.mul(x.unit.ratio);
    }
    return asScalar(x);
  };
  const n = () => asScalar(x);

  switch (name) {
    case "sqrt": {
      if (x.kind === "quantity" && x.unit?.dimension === "area" && x.unit.id.startsWith("sq:")) {
        const base = ctx.reg.unitsById.get(x.unit.id.slice(3));
        if (base) return qty(x.value.sqrt(), base);
      }
      return qty(n().sqrt());
    }
    case "cbrt": return qty(n().cbrt());
    case "sin": return qty(Decimal.sin(angleArg()));
    case "cos": return qty(Decimal.cos(angleArg()));
    case "tan": return qty(Decimal.tan(angleArg()));
    case "cot": return qty(new Decimal(1).div(Decimal.tan(angleArg())));
    case "asin": case "arcsin": return qty(Decimal.asin(n()));
    case "acos": case "arccos": return qty(Decimal.acos(n()));
    case "atan": case "arctan": return qty(Decimal.atan(n()));
    case "sinh": return qty(Decimal.sinh(n()));
    case "cosh": return qty(Decimal.cosh(n()));
    case "tanh": return qty(Decimal.tanh(n()));
    case "ln": return qty(Decimal.ln(n()));
    case "lg": case "log": return qty(Decimal.log10(n()));
    case "log2": return qty(Decimal.log2(n()));
    case "exp": return qty(Decimal.exp(n()));
    case "abs": return x.kind === "quantity" ? { ...x, value: x.value.abs() } : qty(n().abs());
    case "round": return x.kind === "quantity" ? { ...x, value: x.value.round() } : qty(n().round());
    case "ceil": return x.kind === "quantity" ? { ...x, value: x.value.ceil() } : qty(n().ceil());
    case "floor": return x.kind === "quantity" ? { ...x, value: x.value.floor() } : qty(n().floor());
    case "fact": case "factorial": return qty(factorial(n()));
    case "random": {
      const seed = strHash(ctx.line.lineText) ^ (ctx.line.index * 0x9e3779b9);
      const rand = mulberry32(seed);
      if (args.length === 0) return qty(new Decimal(rand));
      const toNum = (v: Value) => v.kind === "quantity" ? v.value.toNumber() : 0;
      const [lo, hi] = args.length === 1 ? [0, toNum(args[0]!)] : [toNum(args[0]!), toNum(args[1]!)];
      const isInt = Number.isInteger(lo) && Number.isInteger(hi);
      const raw = isInt ? Math.floor(rand * (hi - lo + 1)) + lo : rand * (hi - lo) + lo;
      return qty(new Decimal(raw));
    }
    case "until": {
      if (x.kind !== "date") throw new EvalError("until needs a date");
      return evalDateArith("minus", x, { kind: "date", ms: startOfToday(), hasTime: false });
    }
    case "since": {
      if (x.kind !== "date") throw new EvalError("since needs a date");
      return evalDateArith("minus", { kind: "date", ms: startOfToday(), hasTime: false }, x);
    }
    default: throw new EvalError(`unknown function ${name}`);
  }
}

function strHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): number {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function factorial(n: Decimal): Decimal {
  if (!n.isInteger() || n.isNegative() || n.gt(300)) throw new EvalError("bad factorial");
  let acc = new Decimal(1);
  for (let i = 2; i <= n.toNumber(); i++) acc = acc.mul(i);
  return acc;
}
