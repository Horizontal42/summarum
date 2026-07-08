// Splits a line into raw lexemes (numbers, words, symbols). Shared by the
// tokenizer and the phrase registry so both segment text the same way.
import { DateOrder, Decimal, NumeralRepr } from "./types";

export interface Lex {
  type: "num" | "word" | "sym" | "date" | "xref";
  raw: string;
  start: number;
  end: number;
  value?: Decimal;
  repr?: NumeralRepr;
  dateMs?: number;
  sheet?: string;
  key?: string;
}

const WORD_RE = /^[\p{L}_]+/u;
// Number forms, tried in order. Space/NBSP-grouped numbers may use a decimal
// comma ("1 000,5" — what the app itself prints with the space separator);
// comma-grouped is the en convention ("1,000"), and a comma that does not
// form groups of three is a decimal comma ("1,23" → 1.23).
const NUM_SPACE_GROUPED_RE = /^\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?(?!\d)/;
const NUM_COMMA_GROUPED_RE = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?(?!\d)/;
const NUM_DECIMAL_COMMA_RE = /^\d+,\d+/;
const NUM_PLAIN_RE = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/;
// 31.12.2024 / 12/31/2024 — same separator on both sides, 4-digit year
const SLASH_DOT_DATE_RE = /^(\d{1,2})([./])(\d{1,2})\2(\d{4})(?!\d)/;

/** ms for a real calendar date; null when the components roll over (2026-13-45) */
function validDateMs(y: number, mo: number, d: number): number | null {
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d
    ? dt.getTime()
    : null;
}

function tryLexDate(rest: string, i: number, dateOrder: DateOrder): Lex | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?!\d)/.exec(rest);
  if (iso) {
    const ms = validDateMs(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (ms !== null) {
      return { type: "date", raw: iso[0], start: i, end: i + iso[0].length, dateMs: ms };
    }
  }
  const dm = SLASH_DOT_DATE_RE.exec(rest);
  if (dm) {
    const a = Number(dm[1]);
    const b = Number(dm[3]);
    // a>12 must be the day, b>12 must be the month; both ≤12 → configured order
    const dayFirst = a > 12 ? true : b > 12 ? false : dateOrder === "dmy";
    const y = Number(dm[4]);
    const ms = dayFirst ? validDateMs(y, b, a) : validDateMs(y, a, b);
    if (ms !== null) {
      return { type: "date", raw: dm[0], start: i, end: i + dm[0].length, dateMs: ms };
    }
  }
  return null;
}

function tryLexBaseNumber(rest: string, i: number): Lex | null {
  const hex = /^0[xX][0-9a-fA-F]+/.exec(rest);
  if (hex) {
    return { type: "num", raw: hex[0], start: i, end: i + hex[0].length, value: new Decimal(parseInt(hex[0], 16)), repr: "hex" };
  }
  const bin = /^0[bB][01]+/.exec(rest);
  if (bin) {
    return { type: "num", raw: bin[0], start: i, end: i + bin[0].length, value: new Decimal(parseInt(bin[0].slice(2), 2)), repr: "binary" };
  }
  const oct = /^0[oO][0-7]+/.exec(rest);
  if (oct) {
    return { type: "num", raw: oct[0], start: i, end: i + oct[0].length, value: new Decimal(parseInt(oct[0].slice(2), 8)), repr: "octal" };
  }
  return null;
}

function tryLexDecimalNumber(rest: string, i: number): Lex | null {
  let raw: string | null = null;
  let cleaned = "";
  const sp = NUM_SPACE_GROUPED_RE.exec(rest);
  const cg = sp ? null : NUM_COMMA_GROUPED_RE.exec(rest);
  const dc = sp || cg ? null : NUM_DECIMAL_COMMA_RE.exec(rest);
  const pl = sp || cg || dc ? null : NUM_PLAIN_RE.exec(rest);
  if (sp) {
    raw = sp[0];
    cleaned = raw.replace(/[   ]/g, "").replace(",", ".");
  } else if (cg) {
    raw = cg[0];
    cleaned = raw.replace(/,/g, "");
  } else if (dc) {
    raw = dc[0];
    cleaned = raw.replace(",", ".");
  } else if (pl) {
    raw = pl[0];
    cleaned = raw;
  }
  if (raw) {
    return { type: "num", raw, start: i, end: i + raw.length, value: new Decimal(cleaned), repr: "decimal" };
  }
  return null;
}

function tryLexDotNumber(rest: string, i: number): Lex | null {
  if (/^\.\d/.test(rest)) {
    const m = /^\.\d+/.exec(rest)!;
    return { type: "num", raw: m[0], start: i, end: i + m[0].length, value: new Decimal(m[0]), repr: "decimal" };
  }
  return null;
}

function tryLexXRef(rest: string, i: number): Lex | null {
  const bracket = /^@\[([^\]]+)\]\.([\p{L}_][\p{L}\d_]*)/u.exec(rest);
  if (bracket) {
    return { type: "xref", raw: bracket[0], start: i, end: i + bracket[0].length, sheet: bracket[1].trim(), key: bracket[2] };
  }
  const bare = /^@([\p{L}_][\p{L}\d_]*)\.([\p{L}_][\p{L}\d_]*)/u.exec(rest);
  if (bare) {
    return { type: "xref", raw: bare[0], start: i, end: i + bare[0].length, sheet: bare[1], key: bare[2] };
  }
  return null;
}

function tryLexWord(rest: string, i: number): Lex | null {
  const word = WORD_RE.exec(rest);
  if (word) {
    return { type: "word", raw: word[0], start: i, end: i + word[0].length };
  }
  return null;
}

export function lexLine(text: string, dateOrder: DateOrder = "dmy"): Lex[] {
  const out: Lex[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === " " || ch === "\t" || ch === " ") {
      i++;
      continue;
    }
    const rest = text.slice(i);

    let lex: Lex | null = null;
    if (ch >= "0" && ch <= "9") {
      lex = tryLexDate(rest, i, dateOrder) || tryLexBaseNumber(rest, i) || tryLexDecimalNumber(rest, i);
    } else if (ch === ".") {
      lex = tryLexDotNumber(rest, i);
    } else if (ch === "@") {
      lex = tryLexXRef(rest, i);
    }
    if (!lex) {
      lex = tryLexWord(rest, i);
    }

    if (lex) {
      out.push(lex);
      i += lex.raw.length;
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
