// Noise-tolerant Pratt parser. Unknown words are dropped (free text around
// math is allowed), except right after a conversion word — those may name
// a timezone ("time in New York").
import { Decimal, NumeralRepr, Unit } from "./types";
import { Token } from "./tokenizer";
import { PctOp, DateWord, BitOp } from "./registry";

export type ConvTarget =
  | { type: "unit"; unit: Unit }
  | { type: "currency"; code: string; onDate?: string }
  | { type: "repr"; repr: NumeralRepr }
  | { type: "tz"; words: string[] }
  | { type: "scale"; mult: Decimal; label: string }
  | { type: "unix" }
  | { type: "todate" };

export type Node =
  | { k: "num"; v: Decimal; repr: NumeralRepr }
  | { k: "const"; name: "pi" | "e" | "half" | "onehalf" }
  | { k: "var"; name: string }
  | { k: "date"; word: DateWord }
  | { k: "datelit"; ms: number }
  | { k: "xref"; sheet: string; key: string }
  | { k: "agg"; name: "sum" | "avg" | "prev" | "count" | "min" | "max" | "product" | "chart" }
  | { k: "bin"; op: "plus" | "minus" | "mul" | "div" | "mod" | "pow"; l: Node; r: Node }
  | { k: "bit"; op: BitOp; l: Node; r: Node }
  | { k: "pctop"; op: PctOp; l: Node; r: Node }
  | { k: "neg"; x: Node }
  | { k: "pct"; x: Node }
  | { k: "fact"; x: Node }
  | { k: "unit"; x: Node; unit: Unit }
  | { k: "curr"; x: Node; code: string }
  | { k: "scale"; x: Node; mult: Decimal; label: string }
  | { k: "conv"; x: Node; target: ConvTarget }
  | { k: "call"; name: string; args: Node[] }
  | { k: "seq"; items: Node[] }
  | { k: "unknown" }
  | { k: "goalseek"; lhs: Node; rhs: Node };

export interface ParsedLine {
  assign?: string;
  expr: Node | null;
}

const VAR_NAME_RE = /^[\p{L}_][\p{L}\d_]*$/u;

export function parseLine(tokens: Token[], knownVars: Set<string>, line: string): ParsedLine {
  let assign: string | undefined;
  // a defined variable shadows whatever its name tokenized as (unit "m", agg "sum"...)
  let toks: Token[] = tokens.map((tk) => {
    if (tk.t === "word" || tk.t === "num" || tk.t === "junk") return tk;
    const raw = line.slice(tk.start, tk.end);
    return knownVars.has(raw) ? { t: "word", raw, start: tk.start, end: tk.end } : tk;
  });

  // `x = expr` / `x is expr` — the name may have tokenized as a unit (`m = 5`)
  if (toks.length >= 2 && toks[1].t === "assign") {
    const raw = toks[0].t === "word" ? toks[0].raw : line.slice(toks[0].start, toks[0].end);
    if (VAR_NAME_RE.test(raw)) {
      assign = raw;
      toks = toks.slice(2);
    }
  }

  // Noise filtering: drop junk and unknown words, but keep words that follow
  // a conversion operator (potential timezone names).
  const filtered: Token[] = [];
  let afterConv = false;
  for (const tk of toks) {
    if (tk.t === "junk") continue;
    if (tk.t === "word") {
      if (knownVars.has(tk.raw) || afterConv) filtered.push(tk);
      continue;
    }
    // a bare "/" inside a timezone name ("Europe/Berlin") must not break the
    // word-keeping chain, otherwise the second half gets filtered as noise
    if (afterConv && tk.t === "op" && tk.op === "div") {
      filtered.push(tk);
      continue;
    }
    afterConv = tk.t === "conv";
    filtered.push(tk);
  }

  // Goal seek: `? * 1.2 = 1000` → find x where lhs(x) = rhs(x)
  const hasUnknown = filtered.some((tk) => tk.t === "unknown");
  if (hasUnknown) {
    const assignIdx = filtered.findIndex((tk) => tk.t === "assign");
    if (assignIdx >= 0) {
      const lhs = new Parser(filtered.slice(0, assignIdx), knownVars).parseSeq();
      const rhs = new Parser(filtered.slice(assignIdx + 1), knownVars).parseSeq();
      if (lhs && rhs) return { expr: { k: "goalseek", lhs, rhs } };
    }
  }

  const p = new Parser(filtered, knownVars);
  return { assign, expr: p.parseSeq() };
}


const PREC = {
  CONV: 10,
  BIT: 20,
  ADD: 30,
  MUL: 40,
  UNARY: 50,
  POW: 55,
  POSTFIX: 60,
};

class Parser {
  private i = 0;
  constructor(private toks: Token[], private vars: Set<string>) {}

  private peek(): Token | undefined {
    return this.toks[this.i];
  }
  private next(): Token | undefined {
    return this.toks[this.i++];
  }

  /**
   * Line level: a sequence of expressions with line-wide conversions.
   * "2 hours 30 minutes in minutes" converts the merged sum, not the last item.
   */
  parseSeq(): Node | null {
    let items: Node[] = [];
    const mk = (): Node => (items.length === 1 ? items[0] : { k: "seq", items });
    while (this.i < this.toks.length) {
      const tk = this.peek()!;
      if (tk.t === "conv" && items.length > 0) {
        const save = this.i;
        this.i++;
        const target = this.parseTarget();
        if (target) {
          items = [{ k: "conv", x: mk(), target: this.tryHistoricalDate(target) }];
          continue;
        }
        this.i = save + 1; // drop the conversion word, it was noise
        continue;
      }
      if (tk.t === "pctop" && (tk.op.startsWith("as_pct") || tk.op.endsWith("what_is")) && items.length > 0) {
        this.i++;
        const r = this.parseExpr(PREC.ADD);
        if (r) {
          items = [{ k: "pctop", op: tk.op, l: mk(), r }];
          continue;
        }
        continue;
      }
      // an operator after a finished item continues it: "100 USD in EUR + 20"
      if (tk.t === "op" && items.length > 0) {
        const save = this.i;
        this.i++;
        const r = tk.op === "plus" || tk.op === "minus" ? this.parseExpr(PREC.MUL) : this.parseExpr(PREC.UNARY);
        if (r) {
          items = [{ k: "bin", op: tk.op, l: mk(), r }];
          continue;
        }
        this.i = save + 1; // dangling operator is noise
        continue;
      }
      if (tk.t === "bitop" && items.length > 0) {
        const save = this.i;
        this.i++;
        const r = this.parseExpr(PREC.ADD);
        if (r) {
          items = [{ k: "bit", op: tk.op, l: mk(), r }];
          continue;
        }
        this.i = save + 1;
        continue;
      }
      const before = this.i;
      const node = this.parseExpr(PREC.BIT);
      if (node) items.push(node);
      if (this.i === before) this.i++; // skip unparsable token
    }
    if (items.length === 0) return null;
    return mk();
  }

  /**
   * Pratt parser implementation for expressions.
   */
  private parseExpr(minPrec: number = 0): Node | null {
    let tk = this.peek();
    if (!tk) return null;

    let lhs: Node | null = null;

    if (tk.t === "op" && tk.op === "minus") {
      this.i++;
      const x = this.parseExpr(PREC.UNARY);
      if (!x) return null;
      lhs = { k: "neg", x };
    } else if (tk.t === "op" && tk.op === "plus") {
      this.i++;
      lhs = this.parseExpr(PREC.UNARY);
      if (!lhs) return null;
    } else {
      lhs = this.parsePrimary();
    }

    if (!lhs) return null;

    for (;;) {
      tk = this.peek();
      if (!tk) break;

      if (tk.t === "percent") {
        if (PREC.POSTFIX < minPrec) break;
        this.i++;
        lhs = { k: "pct", x: lhs };
        continue;
      }
      if (tk.t === "bang") {
        if (PREC.POSTFIX < minPrec) break;
        this.i++;
        lhs = { k: "fact", x: lhs };
        continue;
      }
      if (tk.t === "unit") {
        if (PREC.POSTFIX < minPrec) break;
        this.i++;
        lhs = { k: "unit", x: lhs, unit: tk.unit };
        continue;
      }
      if (tk.t === "currency") {
        if (PREC.POSTFIX < minPrec) break;
        this.i++;
        lhs = { k: "curr", x: lhs, code: tk.code };
        continue;
      }
      if (tk.t === "scale") {
        if (PREC.POSTFIX < minPrec) break;
        this.i++;
        lhs = { k: "scale", x: lhs, mult: tk.mult, label: "" };
        continue;
      }
      if (tk.t === "op" && tk.op === "pow") {
        if (PREC.POW < minPrec) break;
        const save = this.i;
        this.i++;
        const r = this.parseExpr(PREC.POW);
        if (!r) { this.i = save; break; }
        lhs = { k: "bin", op: "pow", l: lhs, r };
        continue;
      }
      if (tk.t === "op" && (tk.op === "mul" || tk.op === "div" || tk.op === "mod")) {
        if (PREC.MUL < minPrec) break;
        const save = this.i;
        this.i++;
        const r = this.parseExpr(PREC.MUL + 1);
        if (!r) { this.i = save; break; }
        lhs = { k: "bin", op: tk.op, l: lhs, r };
        continue;
      }
      if (tk.t === "pctop" && (tk.op === "of" || tk.op === "off" || tk.op === "on")) {
        if (!(lhs.k === "pct" || lhs.k === "var" || lhs.k === "pctop")) {
          this.i++;
          continue;
        }
        if (PREC.MUL < minPrec) break;
        const save = this.i;
        this.i++;
        const r = this.parseExpr(PREC.MUL + 1);
        if (!r) { this.i = save; break; }
        lhs = { k: "pctop", op: tk.op, l: lhs, r };
        continue;
      }
      if (tk.t === "lparen" || tk.t === "const" || tk.t === "func" || (tk.t === "word" && this.vars.has(tk.raw))) {
        if (PREC.MUL < minPrec) break;
        const save = this.i;
        const r = this.parseExpr(PREC.MUL + 1);
        if (!r) { this.i = save; break; }
        lhs = { k: "bin", op: "mul", l: lhs, r };
        continue;
      }
      if (tk.t === "op" && (tk.op === "plus" || tk.op === "minus")) {
        if (PREC.ADD < minPrec) break;
        const save = this.i;
        this.i++;
        const r = this.parseExpr(PREC.ADD + 1);
        if (!r) { this.i = save; break; }
        lhs = { k: "bin", op: tk.op, l: lhs, r };
        continue;
      }
      if (tk.t === "bitop") {
        if (PREC.BIT < minPrec) break;
        const save = this.i;
        this.i++;
        const r = this.parseExpr(PREC.BIT + 1);
        if (!r) { this.i = save; break; }
        lhs = { k: "bit", op: tk.op, l: lhs, r };
        continue;
      }
      if (tk.t === "conv") {
        if (PREC.CONV < minPrec) break;
        const save = this.i;
        this.i++;
        const target = this.parseTarget();
        if (!target) { this.i = save; break; }
        lhs = { k: "conv", x: lhs, target: this.tryHistoricalDate(target) };
        continue;
      }
      if (tk.t === "pctop" && (tk.op.startsWith("as_pct") || tk.op.endsWith("what_is"))) {
        if (PREC.CONV < minPrec) break;
        const save = this.i;
        this.i++;
        const r = this.parseExpr(PREC.ADD);
        if (!r) { this.i = save; break; }
        lhs = { k: "pctop", op: tk.op, l: lhs, r };
        continue;
      }

      break;
    }
    return lhs;
  }
  /** If the current token is `pctop(on)` + `datelit`, consume them and attach `onDate`. */
  private tryHistoricalDate(target: ConvTarget): ConvTarget {
    if (target.type !== "currency") return target;
    const nx = this.peek();
    if (nx?.t !== "pctop" || nx.op !== "on") return target;
    const save = this.i;
    this.i++;
    const dk = this.peek();
    if (dk?.t === "datelit") {
      this.i++;
      const d = new Date(dk.ms);
      const onDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return { ...target, onDate };
    }
    this.i = save;
    return target;
  }

  private parseTarget(): ConvTarget | null {
    const tk = this.peek();
    if (!tk) return null;
    if (tk.t === "unit") {
      this.i++;
      return { type: "unit", unit: tk.unit };
    }
    if (tk.t === "currency") {
      this.i++;
      return { type: "currency", code: tk.code };
    }
    if (tk.t === "repr") {
      this.i++;
      return { type: "repr", repr: tk.repr };
    }
    if (tk.t === "special") {
      this.i++;
      return tk.name === "unix" ? { type: "unix" } : { type: "todate" };
    }
    if (tk.t === "scale") {
      this.i++;
      return { type: "scale", mult: tk.mult, label: "" };
    }
    if (tk.t === "date" && tk.word === "local") {
      this.i++;
      return { type: "tz", words: ["local"] };
    }
    if (tk.t === "word") {
      const words: string[] = [];
      for (;;) {
        const w = this.peek();
        if (w?.t === "word" && words.length < 4) {
          words.push((this.next() as Token & { raw: string }).raw);
          continue;
        }
        // "Europe/Berlin": a slash between timezone words is part of the name
        if (w?.t === "op" && w.op === "div" && words.length > 0 && this.toks[this.i + 1]?.t === "word") {
          this.next();
          continue;
        }
        break;
      }
      if (words.length > 0) return { type: "tz", words };
    }
    return null;
  }

  private parsePrimary(): Node | null {
    const tk = this.peek();
    if (!tk) return null;
    switch (tk.t) {
      case "num":
        this.i++;
        return { k: "num", v: tk.v, repr: tk.repr };
      case "const":
        this.i++;
        return { k: "const", name: tk.name };
      case "date":
        this.i++;
        return { k: "date", word: tk.word };
      case "datelit":
        this.i++;
        return { k: "datelit", ms: tk.ms };
      case "xref":
        this.i++;
        return { k: "xref", sheet: tk.sheet, key: tk.key };
      case "agg":
        this.i++;
        return { k: "agg", name: tk.name };
      case "word":
        if (this.vars.has(tk.raw)) {
          this.i++;
          return { k: "var", name: tk.raw };
        }
        return null;
      case "func": {
        this.i++;
        const name = tk.name;
        if (this.peek()?.t === "lparen") {
          this.i++;
          const args: Node[] = [];
          for (;;) {
            const arg = this.parseExpr(PREC.CONV);
            if (arg) args.push(arg);
            const nx = this.peek();
            if (nx?.t === "semicolon") {
              this.i++;
              continue;
            }
            if (nx?.t === "rparen") {
              this.i++;
              break;
            }
            if (!nx) break;
            if (!arg) {
              this.i++; // skip stray token inside call
            }
          }
          return { k: "call", name, args };
        }
        // `sqrt 16` / `square root of 16` — the "of" is decorative
        const nx = this.peek();
        if (nx?.t === "pctop" && nx.op === "of") this.i++;
        const arg = this.parseExpr(PREC.UNARY);
        return arg ? { k: "call", name, args: [arg] } : null;
      }
      case "lparen": {
        this.i++;
        const inner = this.parseExpr(PREC.CONV);
        if (this.peek()?.t === "rparen") this.i++;
        return inner;
      }
      case "currency": {
        // prefix currency: $9
        const nxt = this.toks[this.i + 1];
        if (nxt?.t === "num") {
          this.i += 2;
          return { k: "curr", x: { k: "num", v: nxt.v, repr: nxt.repr }, code: tk.code };
        }
        return null;
      }
      case "unknown":
        this.i++;
        return { k: "unknown" };
      default:
        return null;
    }
  }
}
