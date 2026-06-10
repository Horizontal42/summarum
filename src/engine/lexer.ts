// Splits a line into raw lexemes (numbers, words, symbols). Shared by the
// tokenizer and the phrase registry so both segment text the same way.
import { Decimal, NumeralRepr } from "./types";

export interface Lex {
  type: "num" | "word" | "sym";
  raw: string;
  start: number;
  end: number;
  value?: Decimal;
  repr?: NumeralRepr;
}

const WORD_RE = /^[\p{L}_]+/u;
// Order matters: grouped thousands first, then plain decimal/exponent, then leading-dot.
const NUM_RE = /^(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)/;

export function lexLine(text: string): Lex[] {
  const out: Lex[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === " " || ch === "\t" || ch === " ") {
      i++;
      continue;
    }
    const rest = text.slice(i);

    if (ch >= "0" && ch <= "9") {
      const hex = /^0[xX][0-9a-fA-F]+/.exec(rest);
      if (hex) {
        out.push({ type: "num", raw: hex[0], start: i, end: i + hex[0].length, value: new Decimal(parseInt(hex[0], 16)), repr: "hex" });
        i += hex[0].length;
        continue;
      }
      const bin = /^0[bB][01]+/.exec(rest);
      if (bin) {
        out.push({ type: "num", raw: bin[0], start: i, end: i + bin[0].length, value: new Decimal(parseInt(bin[0].slice(2), 2)), repr: "binary" });
        i += bin[0].length;
        continue;
      }
      const oct = /^0[oO][0-7]+/.exec(rest);
      if (oct) {
        out.push({ type: "num", raw: oct[0], start: i, end: i + oct[0].length, value: new Decimal(parseInt(oct[0].slice(2), 8)), repr: "octal" });
        i += oct[0].length;
        continue;
      }
    }
    const num = NUM_RE.exec(rest);
    if (num && (ch >= "0" && ch <= "9")) {
      const raw = num[0];
      out.push({ type: "num", raw, start: i, end: i + raw.length, value: new Decimal(raw.replace(/,/g, "")), repr: "decimal" });
      i += raw.length;
      continue;
    }
    if (ch === "." && /^\.\d/.test(rest)) {
      const m = /^\.\d+/.exec(rest)!;
      out.push({ type: "num", raw: m[0], start: i, end: i + m[0].length, value: new Decimal(m[0]), repr: "decimal" });
      i += m[0].length;
      continue;
    }

    const word = WORD_RE.exec(rest);
    if (word) {
      out.push({ type: "word", raw: word[0], start: i, end: i + word[0].length });
      i += word[0].length;
      continue;
    }

    out.push({ type: "sym", raw: ch, start: i, end: i + 1 });
    i++;
  }
  return out;
}

/** Lexemes of a vocabulary phrase (positions are irrelevant). */
export function lexPhrase(phrase: string): string[] {
  return lexLine(phrase).map((l) => l.raw);
}
