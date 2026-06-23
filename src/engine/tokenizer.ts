// Lexes a line and resolves phrases through the registry into semantic tokens.
import { Decimal, NumeralRepr, Unit } from "./types";
import { lexLine } from "./lexer";
import { Registry, PctOp, DateWord, BitOp } from "./registry";

export type Token =
  | { t: "num"; v: Decimal; repr: NumeralRepr; start: number; end: number }
  | { t: "unit"; unit: Unit; start: number; end: number }
  | { t: "currency"; code: string; start: number; end: number }
  | { t: "op"; op: "plus" | "minus" | "mul" | "div" | "mod" | "pow"; start: number; end: number }
  | { t: "bitop"; op: BitOp; start: number; end: number }
  | { t: "special"; name: "unix" | "todate"; start: number; end: number }
  | { t: "conv"; start: number; end: number }
  | { t: "assign"; start: number; end: number }
  | { t: "pctop"; op: PctOp; start: number; end: number }
  | { t: "percent"; start: number; end: number }
  | { t: "func"; name: string; start: number; end: number }
  | { t: "agg"; name: "sum" | "avg" | "prev"; start: number; end: number }
  | { t: "scale"; mult: Decimal; start: number; end: number }
  | { t: "repr"; repr: NumeralRepr; start: number; end: number }
  | { t: "date"; word: DateWord; start: number; end: number }
  | { t: "const"; name: "pi" | "e" | "half" | "onehalf"; start: number; end: number }
  | { t: "lparen"; start: number; end: number }
  | { t: "rparen"; start: number; end: number }
  | { t: "semicolon"; start: number; end: number }
  | { t: "bang"; start: number; end: number }
  | { t: "word"; raw: string; start: number; end: number }
  | { t: "junk"; raw: string; start: number; end: number };

const SYM_OPS: Record<string, Token["t"] | "plus" | "minus" | "mul" | "div" | "pow"> = {};

export function tokenize(line: string, reg: Registry): Token[] {
  void SYM_OPS;
  const lexes = lexLine(line);
  const lowers = lexes.map((l) => l.raw.toLowerCase());
  const tokens: Token[] = [];
  let i = 0;
  while (i < lexes.length) {
    const lx = lexes[i];
    const span = { start: lx.start, end: lx.end };

    if (lx.type === "num") {
      tokens.push({ t: "num", v: lx.value!, repr: lx.repr!, ...span });
      i++;
      continue;
    }

    const m = reg.match(lexes, lowers, i);
    if (m) {
      const end = lexes[i + m.length - 1].end;
      const s = { start: lx.start, end };
      const p = m.payload;
      switch (p.t) {
        case "unit": tokens.push({ t: "unit", unit: p.unit, ...s }); break;
        case "currency": tokens.push({ t: "currency", code: p.code, ...s }); break;
        case "op": tokens.push({ t: "op", op: p.op, ...s }); break;
        case "bitop": tokens.push({ t: "bitop", op: p.op, ...s }); break;
        case "special": tokens.push({ t: "special", name: p.name, ...s }); break;
        case "conv": tokens.push({ t: "conv", ...s }); break;
        case "assign": tokens.push({ t: "assign", ...s }); break;
        case "pctop": tokens.push({ t: "pctop", op: p.op, ...s }); break;
        case "percent": tokens.push({ t: "percent", ...s }); break;
        case "func": tokens.push({ t: "func", name: p.name, ...s }); break;
        case "agg": tokens.push({ t: "agg", name: p.name, ...s }); break;
        case "scale": tokens.push({ t: "scale", mult: p.mult, ...s }); break;
        case "repr": tokens.push({ t: "repr", repr: p.repr, ...s }); break;
        case "date": tokens.push({ t: "date", word: p.word, ...s }); break;
        case "const": tokens.push({ t: "const", name: p.name, ...s }); break;
      }
      i += m.length;
      continue;
    }

    if (lx.type === "sym") {
      // << and >> arrive as two single-char lexemes
      const nextLx = lexes[i + 1];
      if ((lx.raw === "<" || lx.raw === ">") && nextLx?.type === "sym" && nextLx.raw === lx.raw && nextLx.start === lx.end) {
        tokens.push({ t: "bitop", op: lx.raw === "<" ? "shl" : "shr", start: lx.start, end: nextLx.end });
        i += 2;
        continue;
      }
      switch (lx.raw) {
        case "&": tokens.push({ t: "bitop", op: "band", ...span }); break;
        case "|": tokens.push({ t: "bitop", op: "bor", ...span }); break;
        case "+": tokens.push({ t: "op", op: "plus", ...span }); break;
        case "-": case "−": case "–": tokens.push({ t: "op", op: "minus", ...span }); break;
        case "*": case "×": case "·": tokens.push({ t: "op", op: "mul", ...span }); break;
        case "/": case "÷": tokens.push({ t: "op", op: "div", ...span }); break;
        case "^": tokens.push({ t: "op", op: "pow", ...span }); break;
        case "%": tokens.push({ t: "percent", ...span }); break;
        case "(": tokens.push({ t: "lparen", ...span }); break;
        case ")": tokens.push({ t: "rparen", ...span }); break;
        case "=": tokens.push({ t: "assign", ...span }); break;
        case ";": tokens.push({ t: "semicolon", ...span }); break;
        case "!": tokens.push({ t: "bang", ...span }); break;
        default: tokens.push({ t: "junk", raw: lx.raw, ...span });
      }
      i++;
      continue;
    }

    tokens.push({ t: "word", raw: lx.raw, ...span });
    i++;
  }
  return disambiguateIn(tokens, reg, line);
}

/**
 * "5 ft 4 in in cm" / "6 ft 3 in": the word "in" right after a number,
 * followed by another conversion word, an operator or the end of the line,
 * actually means inches.
 */
function disambiguateIn(tokens: Token[], reg: Registry, line: string): Token[] {
  const inch = reg.unitsById.get("inch");
  if (!inch) return tokens;
  return tokens.map((tk, i) => {
    if (tk.t !== "conv" || line.slice(tk.start, tk.end).toLowerCase() !== "in") return tk;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    const prevIsNum = prev?.t === "num";
    const nextEnds = !next || next.t === "conv" || next.t === "op" || next.t === "rparen";
    if (prevIsNum && nextEnds) {
      return { t: "unit", unit: inch, start: tk.start, end: tk.end } as Token;
    }
    return tk;
  });
}
