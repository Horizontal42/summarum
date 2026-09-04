// Lexes a line and resolves phrases through the registry into semantic tokens.
import { DateOrder, Decimal, NumeralRepr, Unit } from "./types";
import { Lex, lexLine } from "./lexer";
import { Registry, PctOp, DateWord, BitOp, Payload } from "./registry";

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
  | { t: "agg"; name: "sum" | "avg" | "prev" | "count" | "min" | "max" | "product" | "chart"; start: number; end: number }
  | { t: "scale"; mult: Decimal; start: number; end: number }
  | { t: "repr"; repr: NumeralRepr; start: number; end: number }
  | { t: "date"; word: DateWord; start: number; end: number }
  | { t: "datelit"; ms: number; start: number; end: number }
  | { t: "xref"; sheet: string; key: string; start: number; end: number }
  | { t: "const"; name: "pi" | "e" | "half" | "onehalf"; start: number; end: number }
  | { t: "lparen"; start: number; end: number }
  | { t: "rparen"; start: number; end: number }
  | { t: "semicolon"; start: number; end: number }
  | { t: "bang"; start: number; end: number }
  | { t: "word"; raw: string; start: number; end: number }
  | { t: "unknown"; start: number; end: number }
  | { t: "junk"; raw: string; start: number; end: number };

export function tokenize(line: string, reg: Registry, dateOrder: DateOrder = "dmy"): Token[] {
  const lexes = lexLine(line, dateOrder);
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

    if (lx.type === "date") {
      tokens.push({ t: "datelit", ms: lx.dateMs!, ...span });
      i++;
      continue;
    }

    if (lx.type === "xref") {
      tokens.push({ t: "xref", sheet: lx.sheet!, key: lx.key!, ...span });
      i++;
      continue;
    }

    const m = reg.match(lexes, lowers, i);
    if (m) {
      const end = lexes[i + m.length - 1].end;
      tokens.push(handleRegistryMatch(m.payload, { start: lx.start, end }));
      i += m.length;
      continue;
    }

    if (lx.type === "sym") {
      const [tk, skip] = handleSymbol(lx, lexes, i, span);
      tokens.push(tk);
      i += skip;
      continue;
    }

    tokens.push({ t: "word", raw: lx.raw, ...span });
    i++;
  }
  return disambiguateMinAgg(disambiguateIn(tokens, reg, line), reg, line);
}

function handleRegistryMatch(p: Payload, s: { start: number; end: number }): Token {
  switch (p.t) {
    case "unit": return { t: "unit", unit: p.unit, ...s };
    case "currency": return { t: "currency", code: p.code, ...s };
    case "op": return { t: "op", op: p.op, ...s };
    case "bitop": return { t: "bitop", op: p.op, ...s };
    case "special": return { t: "special", name: p.name, ...s };
    case "conv": return { t: "conv", ...s };
    case "assign": return { t: "assign", ...s };
    case "pctop": return { t: "pctop", op: p.op, ...s };
    case "percent": return { t: "percent", ...s };
    case "func": return { t: "func", name: p.name, ...s };
    case "agg": return { t: "agg", name: p.name, ...s };
    case "scale": return { t: "scale", mult: p.mult, ...s };
    case "repr": return { t: "repr", repr: p.repr, ...s };
    case "date": return { t: "date", word: p.word, ...s };
    case "const": return { t: "const", name: p.name, ...s };
  }
}

function handleSymbol(lx: Lex, lexes: Lex[], i: number, span: { start: number; end: number }): [Token, number] {
  const nextLx = lexes[i + 1];
  if ((lx.raw === "<" || lx.raw === ">") && nextLx?.type === "sym" && nextLx.raw === lx.raw && nextLx.start === lx.end) {
    return [{ t: "bitop", op: lx.raw === "<" ? "shl" : "shr", start: lx.start, end: nextLx.end }, 2];
  }
  switch (lx.raw) {
    case "&": return [{ t: "bitop", op: "band", ...span }, 1];
    case "|": return [{ t: "bitop", op: "bor", ...span }, 1];
    case "+": return [{ t: "op", op: "plus", ...span }, 1];
    case "-": case "−": case "–": return [{ t: "op", op: "minus", ...span }, 1];
    case "*": case "×": case "·": return [{ t: "op", op: "mul", ...span }, 1];
    case "/": case "÷": return [{ t: "op", op: "div", ...span }, 1];
    case "^": return [{ t: "op", op: "pow", ...span }, 1];
    case "%": return [{ t: "percent", ...span }, 1];
    case "(": return [{ t: "lparen", ...span }, 1];
    case ")": return [{ t: "rparen", ...span }, 1];
    case "=": return [{ t: "assign", ...span }, 1];
    case ";": return [{ t: "semicolon", ...span }, 1];
    case "!": return [{ t: "bang", ...span }, 1];
    case "?": return [{ t: "unknown", ...span }, 1];
    default: return [{ t: "junk", raw: lx.raw, ...span }, 1];
  }
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

/**
 * "5 min": the "min" aggregate keyword (registered first, so it wins the
 * phrase in the registry) collides with the minute unit's "min"/"мин"
 * abbreviation. Right after a number it can only mean minutes — the
 * standalone `min` aggregate line has no preceding number to collide with.
 */
function disambiguateMinAgg(tokens: Token[], reg: Registry, line: string): Token[] {
  const minute = reg.unitsById.get("minute");
  if (!minute) return tokens;
  return tokens.map((tk, i) => {
    if (tk.t !== "agg" || tk.name !== "min") return tk;
    const raw = line.slice(tk.start, tk.end).toLowerCase();
    if (raw !== "min" && raw !== "мин") return tk;
    if (tokens[i - 1]?.t !== "num") return tk;
    return { t: "unit", unit: minute, start: tk.start, end: tk.end } as Token;
  });
}
