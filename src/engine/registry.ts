// Phrase registry: maps every phrase the engine understands (units,
// currencies, word-operators, functions, scales, date words) to a payload
// for the tokenizer. Longest phrase wins; case-sensitive entries (symbols
// like "m"/"M", "kB") are tried before the case-insensitive ones.
import { Decimal, Dimension, NumeralRepr, Unit, Value } from "./types";
import { Lex, lexLine } from "./lexer";
import * as vocab from "./vocab";
import { UNIT_DATA, SI_PREFIXES, DATA_SI_PREFIXES, IEC_PREFIXES, SCALE_DATA } from "./unitdata";
import { EXTRA_UNITS, CRYPTO } from "./extraunits";

export type PctOp =
  | "of" | "off" | "on"
  | "as_pct_of" | "as_pct_off" | "as_pct_on"
  | "of_what_is" | "off_what_is" | "on_what_is";

export type DateWord = "today" | "tomorrow" | "yesterday" | "now" | "time" | "local";

export type BitOp = "band" | "bor" | "bxor" | "shl" | "shr";

export type Payload =
  | { t: "unit"; unit: Unit }
  | { t: "currency"; code: string }
  | { t: "op"; op: "plus" | "minus" | "mul" | "div" | "mod" }
  | { t: "bitop"; op: BitOp }
  | { t: "conv" }
  | { t: "assign" }
  | { t: "pctop"; op: PctOp }
  | { t: "percent" }
  | { t: "func"; name: string }
  | { t: "agg"; name: "sum" | "avg" | "prev" | "count" | "min" | "max" | "product" | "chart" }
  | { t: "scale"; mult: Decimal }
  | { t: "repr"; repr: NumeralRepr }
  | { t: "special"; name: "unix" | "todate" }
  | { t: "date"; word: DateWord }
  | { t: "const"; name: "pi" | "e" | "half" | "onehalf" };

interface PhraseEntry {
  lexemes: string[]; // raw, as in the phrase
  lower: string[];
  caseSensitive: boolean;
  /**
   * per-gap flag: word/number lexemes glued together in the phrase ("log2")
   * must also be glued in the input — otherwise "log 2" matches log2
   */
  mustTouch: boolean[];
  payload: Payload;
}

export type ExtensionFunc = (args: Value[]) => Value;

export interface Completion {
  label: string;
  type: "unit" | "currency" | "function" | "keyword" | "variable";
  detail?: string;
}

const BUILTIN_FUNCS = [
  "sqrt", "cbrt", "sin", "cos", "tan", "cot", "asin", "acos", "atan",
  "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh",
  "ln", "lg", "log", "log2", "exp", "abs", "round", "ceil", "floor",
  "fact", "factorial", "random",
];

export class Registry {
  /** key: lowercased first lexeme */
  private byFirst = new Map<string, PhraseEntry[]>();
  unitsById = new Map<string, Unit>();
  currencyCodes = new Set<string>();
  currencyFormat = new Map<string, string>();
  /** code -> currency units per 1 USD */
  rates = new Map<string, Decimal>();
  customFuncs = new Map<string, ExtensionFunc>();
  completions: Completion[] = [];

  addPhrase(phrase: string, payload: Payload, opts: { caseSensitive?: boolean } = {}): void {
    const lexs = lexLine(phrase);
    if (lexs.length === 0) return;
    const lexemes = lexs.map((l) => l.raw);
    const caseSensitive = opts.caseSensitive ?? lexemes.every((l) => l.length <= 2);
    const wordOrNum = (t: Lex["type"]) => t === "word" || t === "num";
    const mustTouch: boolean[] = [];
    for (let k = 1; k < lexs.length; k++) {
      mustTouch.push(lexs[k].start === lexs[k - 1].end && wordOrNum(lexs[k].type) && wordOrNum(lexs[k - 1].type));
    }
    const entry: PhraseEntry = { lexemes, lower: lexemes.map((l) => l.toLowerCase()), caseSensitive, mustTouch, payload };
    const key = entry.lower[0];
    const list = this.byFirst.get(key);
    if (list) {
      // first registration of an identical phrase wins (core vocab is added first)
      if (list.some((e) => e.caseSensitive === caseSensitive && (caseSensitive ? e.lexemes.join(" ") === lexemes.join(" ") : e.lower.join(" ") === entry.lower.join(" ")))) {
        return;
      }
      list.push(entry);
      list.sort((a, b) => b.lexemes.length - a.lexemes.length || Number(b.caseSensitive) - Number(a.caseSensitive));
    } else {
      this.byFirst.set(key, [entry]);
    }
  }

  /**
   * Match the longest phrase at position i of the lexeme stream.
   * lexes are the lexemes of the input line, lowers their lowercased raws.
   */
  match(lexes: Lex[], lowers: string[], i: number): { payload: Payload; length: number } | null {
    const list = this.byFirst.get(lowers[i]);
    if (!list) return null;
    for (const e of list) {
      if (i + e.lexemes.length > lexes.length) continue;
      let ok = true;
      for (let k = 0; k < e.lexemes.length; k++) {
        if (e.caseSensitive ? lexes[i + k].raw !== e.lexemes[k] : lowers[i + k] !== e.lower[k]) {
          ok = false;
          break;
        }
        if (k > 0 && e.mustTouch[k - 1] && lexes[i + k].start !== lexes[i + k - 1].end) {
          ok = false;
          break;
        }
      }
      if (ok) return { payload: e.payload, length: e.lexemes.length };
    }
    return null;
  }

  setRates(rates: Record<string, number | string>): void {
    this.rates.clear();
    for (const [code, v] of Object.entries(rates)) {
      const d = new Decimal(v);
      if (d.isFinite() && d.gt(0)) this.rates.set(code.toUpperCase(), d);
    }
    this.rates.set("USD", new Decimal(1));
  }

  makeCurrencyUnit(code: string): Unit | null {
    const rate = this.rates.get(code);
    if (!rate) return null;
    return {
      id: code,
      dimension: "currency",
      ratio: new Decimal(1).div(rate), // USD per 1 unit
      format: this.currencyFormat.get(code) ?? `{} ${code}`,
    };
  }

  isFunc(name: string): boolean {
    return BUILTIN_FUNCS.includes(name) || this.customFuncs.has(name);
  }
}

function addUnitPhrases(reg: Registry, phrases: string[], unit: Unit, opts: { caseSensitive?: boolean } = {}): void {
  reg.unitsById.set(unit.id, unit);
  for (const p of phrases) reg.addPhrase(p, { t: "unit", unit }, opts);
}

export function buildRegistry(): Registry {
  const reg = new Registry();

  // operators, percent, dates, numerals, scales, aggregates
  const ops: Array<[string, Payload]> = [
    ["plus", { t: "op", op: "plus" }],
    ["minus", { t: "op", op: "minus" }],
    ["multiply", { t: "op", op: "mul" }],
    ["divide", { t: "op", op: "div" }],
  ];
  for (const [key, payload] of ops) {
    for (const v of vocab.variants("Operations", `${key}.variants`)) reg.addPhrase(v, payload, { caseSensitive: false });
  }
  for (const v of vocab.variants("Operations", "conversion.variants")) reg.addPhrase(v, { t: "conv" }, { caseSensitive: false });
  for (const v of vocab.variants("Operations", "assignment.variants")) reg.addPhrase(v, { t: "assign" }, { caseSensitive: false });
  for (const v of vocab.variants("Operations", "sum.variants")) reg.addPhrase(v, { t: "agg", name: "sum" }, { caseSensitive: false });
  for (const v of vocab.variants("Operations", "avg.variants")) reg.addPhrase(v, { t: "agg", name: "avg" }, { caseSensitive: false });
  for (const v of vocab.variants("Operations", "prev.variants")) reg.addPhrase(v, { t: "agg", name: "prev" }, { caseSensitive: false });
  for (const v of vocab.variants("Operations", "count.variants")) reg.addPhrase(v, { t: "agg", name: "count" }, { caseSensitive: false });
  for (const v of vocab.variants("Operations", "min.variants")) reg.addPhrase(v, { t: "agg", name: "min" }, { caseSensitive: false });
  for (const v of vocab.variants("Operations", "max.variants")) reg.addPhrase(v, { t: "agg", name: "max" }, { caseSensitive: false });
  for (const v of vocab.variants("Operations", "product.variants")) reg.addPhrase(v, { t: "agg", name: "product" }, { caseSensitive: false });
  for (const v of vocab.variants("Operations", "chart.variants")) reg.addPhrase(v, { t: "agg", name: "chart" }, { caseSensitive: false });
  for (const v of vocab.variants("Operations", "sqrt.variants")) reg.addPhrase(v, { t: "func", name: "sqrt" }, { caseSensitive: false });
  for (const v of vocab.variants("Operations", "cbrt.variants")) reg.addPhrase(v, { t: "func", name: "cbrt" }, { caseSensitive: false });
  for (const v of vocab.variants("Operations", "abs.variants")) reg.addPhrase(v, { t: "func", name: "abs" }, { caseSensitive: false });
  for (const v of vocab.variants("Operations", "ln.variants")) reg.addPhrase(v, { t: "func", name: "ln" }, { caseSensitive: false });
  for (const v of vocab.variants("Operations", "log.variants")) reg.addPhrase(v, { t: "func", name: "log" }, { caseSensitive: false });
  for (const v of vocab.variants("Operations", "round.variants")) reg.addPhrase(v, { t: "func", name: "round" }, { caseSensitive: false });
  reg.addPhrase("mod", { t: "op", op: "mod" }, { caseSensitive: false });
  reg.addPhrase("modulo", { t: "op", op: "mod" }, { caseSensitive: false });

  // bitwise: "and" stays an addition word, so & | xor shl shr
  reg.addPhrase("xor", { t: "bitop", op: "bxor" }, { caseSensitive: false });
  reg.addPhrase("or", { t: "bitop", op: "bor" }, { caseSensitive: false });
  reg.addPhrase("shl", { t: "bitop", op: "shl" }, { caseSensitive: false });
  reg.addPhrase("shr", { t: "bitop", op: "shr" }, { caseSensitive: false });

  // unix timestamps and extra numeral representations
  for (const v of ["unix", "unixtime", "unix time", "timestamp", "таймстамп"]) {
    reg.addPhrase(v, { t: "special", name: "unix" }, { caseSensitive: false });
  }
  for (const v of ["date", "datetime", "дата", "дату", "датой"]) {
    reg.addPhrase(v, { t: "special", name: "todate" }, { caseSensitive: false });
  }
  for (const v of ["fraction", "fractions", "дробь", "дробью", "дроби"]) {
    reg.addPhrase(v, { t: "repr", repr: "fraction" }, { caseSensitive: false });
  }
  for (const v of ["roman", "roman numerals", "римские", "римскими"]) {
    reg.addPhrase(v, { t: "repr", repr: "roman" }, { caseSensitive: false });
  }

  for (const v of vocab.variants("Percent", "percent.variants")) reg.addPhrase(v, { t: "percent" });
  const pctOps: Array<[string, PctOp]> = [
    ["percent_of", "of"], ["percent_off", "off"], ["percent_on", "on"],
    ["as_a_percent_of", "as_pct_of"], ["as_a_percent_off", "as_pct_off"], ["as_a_percent_on", "as_pct_on"],
    ["percent_of_what_is", "of_what_is"], ["percent_off_what_is", "off_what_is"], ["percent_on_what_is", "on_what_is"],
  ];
  for (const [key, op] of pctOps) {
    for (const v of vocab.variants("Percent", `${key}.variants`)) reg.addPhrase(v, { t: "pctop", op }, { caseSensitive: false });
  }

  const dateWords: Array<[string, DateWord]> = [
    ["today", "today"], ["tomorrow", "tomorrow"], ["yesterday", "yesterday"],
  ];
  for (const [key, word] of dateWords) {
    for (const v of vocab.variants("Dates", `${key}.variants`)) reg.addPhrase(v, { t: "date", word }, { caseSensitive: false });
  }
  for (const v of vocab.variants("Dates", "current_time.variants")) reg.addPhrase(v, { t: "date", word: v.toLowerCase() === "now" || v.toLowerCase() === "сейчас" ? "now" : "time" }, { caseSensitive: false });
  for (const v of vocab.variants("Dates", "local_time.variants")) reg.addPhrase(v, { t: "date", word: "local" }, { caseSensitive: false });

  const reprs: Array<[string, NumeralRepr]> = [
    ["hex", "hex"], ["binary", "binary"], ["octal", "octal"], ["decimal", "decimal"], ["scientific", "scientific"],
  ];
  for (const [key, repr] of reprs) {
    for (const v of vocab.variants("Numbers", `${key}.variants`)) reg.addPhrase(v, { t: "repr", repr }, { caseSensitive: false });
  }

  for (const [id, mult] of Object.entries(SCALE_DATA)) {
    for (const v of vocab.variants("Scales", `${id}.variants`)) {
      reg.addPhrase(v, { t: "scale", mult: new Decimal(mult) });
    }
  }

  reg.addPhrase("pi", { t: "const", name: "pi" }, { caseSensitive: false });
  reg.addPhrase("π", { t: "const", name: "pi" });
  reg.addPhrase("пи", { t: "const", name: "pi" }, { caseSensitive: false });
  reg.addPhrase("e", { t: "const", name: "e" }, { caseSensitive: true });
  reg.addPhrase("a half", { t: "const", name: "half" }, { caseSensitive: false });
  reg.addPhrase("one half", { t: "const", name: "half" }, { caseSensitive: false });
  reg.addPhrase("половина", { t: "const", name: "half" }, { caseSensitive: false });
  reg.addPhrase("one and a half", { t: "const", name: "onehalf" }, { caseSensitive: false });
  reg.addPhrase("полтора", { t: "const", name: "onehalf" }, { caseSensitive: false });
  reg.addPhrase("полторы", { t: "const", name: "onehalf" }, { caseSensitive: false });

  for (const f of BUILTIN_FUNCS) reg.addPhrase(f, { t: "func", name: f }, { caseSensitive: false });

  // units, SI/IEC prefixes, area/volume templates
  interface LengthPhrase { phrase: string; unit: Unit; caseSensitive?: boolean }
  const lengthPhrases: LengthPhrase[] = [];
  /** lowercased composed symbol -> unit; null = ambiguous (mm vs Mm) */
  const lenientSym = new Map<string, Unit | null>();

  for (const d of UNIT_DATA) {
    const variants = vocab.variants(d.category, `${d.id}.variants`);
    const format = vocab.entryEn(d.category, `${d.id}.format`) ?? d.format ?? d.id;
    const symbol = vocab.entryEn(d.category, `${d.id}.symbol`);
    const symbolsAll = vocab.entriesAll(d.category, `${d.id}.symbol`);
    const unit: Unit = {
      id: d.id,
      dimension: d.dimension,
      ratio: new Decimal(d.ratio),
      ...(d.offset ? { offset: new Decimal(d.offset) } : {}),
      format,
    };
    addUnitPhrases(reg, variants, unit);
    if (d.dimension === "length") {
      for (const v of variants) lengthPhrases.push({ phrase: v, unit });
    }

    if (d.prefixes) {
      let prefixes = d.prefixes === "si" ? SI_PREFIXES : [...DATA_SI_PREFIXES, ...IEC_PREFIXES];
      if (d.id === "second") {
        // only sub-second prefixes are useful; "as" (attosecond) would
        // shadow the conversion word "as", "das"/"hs" are noise
        prefixes = prefixes.filter((p) => ["milli", "micro", "nano", "pico"].includes(p.id));
      }
      const wordVariants = variants.filter((v) => v.length > 2 && /^[\p{L}]+$/u.test(v));
      for (const p of prefixes) {
        const pWords = vocab.variants(p.category, `${p.id}.prefix`);
        const pSym = vocab.entryEn(p.category, `${p.id}.symbol`) ?? "";
        const pSymsAll = vocab.entriesAll(p.category, `${p.id}.symbol`);
        const mult = new Decimal(p.mult);
        const pUnit: Unit = {
          id: `${p.id}:${d.id}`,
          dimension: d.dimension,
          ratio: unit.ratio.mul(mult),
          format: pSym + (symbol ?? format),
        };
        const phrases: string[] = [];
        const csPhrases: string[] = [];
        if (d.id === "bit") {
          // no "kb" for bits — bare *b symbols mean bytes (common expectation)
          csPhrases.push(`${pSym}bit`);
        } else {
          // symbol compositions in every locale: "km" and "км"
          for (const ps of pSymsAll) for (const us of symbolsAll) csPhrases.push(ps + us);
        }
        for (const pw of pWords) for (const wv of wordVariants) phrases.push(pw + wv);
        if (d.id === "byte" && pSym) {
          // lenient: KB/kb/Kb all mean kilobyte
          phrases.push((pSym + "b").toLowerCase());
        }
        reg.unitsById.set(pUnit.id, pUnit);
        for (const ph of csPhrases) reg.addPhrase(ph, { t: "unit", unit: pUnit }, { caseSensitive: true });
        for (const ph of phrases) reg.addPhrase(ph, { t: "unit", unit: pUnit }, { caseSensitive: false });
        // collect unambiguous lowercase forms: "KM"/"Km" should still mean km,
        // while "mm"/"Mm" stay strict (milli vs mega)
        for (const ph of csPhrases) {
          const lower = ph.toLowerCase();
          const prev = lenientSym.get(lower);
          if (prev === undefined) lenientSym.set(lower, pUnit);
          else if (prev && prev.id !== pUnit.id) lenientSym.set(lower, null);
        }
        if (d.dimension === "length") {
          for (const ph of csPhrases) lengthPhrases.push({ phrase: ph, unit: pUnit, caseSensitive: true });
          for (const pw of pWords) for (const wv of wordVariants) lengthPhrases.push({ phrase: pw + wv, unit: pUnit, caseSensitive: false });
        }
      }
    }
  }

  for (const [lower, unit] of lenientSym) {
    if (unit) reg.addPhrase(lower, { t: "unit", unit }, { caseSensitive: false });
  }

  // Area/volume from templates: "square %@" / "cubic %@" applied to every length phrase
  const applyTemplates = (
    templates: string[],
    fmtTemplate: string,
    dim: Dimension,
    pow: 2 | 3,
    idPrefix: string,
  ) => {
    for (const t of templates) {
      for (const lp of lengthPhrases) {
        const phrase = t.replace("%@", lp.phrase);
        const id = `${idPrefix}:${lp.unit.id}`;
        let u = reg.unitsById.get(id);
        if (!u) {
          u = {
            id,
            dimension: dim,
            ratio: lp.unit.ratio.pow(pow),
            format: fmtTemplate.replace("%@", lp.unit.format),
          };
          reg.unitsById.set(id, u);
        }
        reg.addPhrase(phrase, { t: "unit", unit: u }, lp.caseSensitive !== undefined ? { caseSensitive: lp.caseSensitive } : {});
      }
    }
  };
  applyTemplates(vocab.variants("Area", "area.templates"), vocab.entryEn("Area", "area.format") ?? "%@²", "area", 2, "sq");
  applyTemplates(vocab.variants("Volume", "volume.templates"), vocab.entryEn("Volume", "volume.format") ?? "%@³", "volume", 3, "cb");

  // currencies
  // Major currencies register first so they win generic phrases
  // ("доллар" belongs to USD, not TTD which lists it too and sorts earlier).
  const PRIORITY = [
    "USD", "EUR", "GBP", "RUB", "JPY", "CNY", "CHF", "CAD", "AUD", "UAH",
    "BYN", "KZT", "PLN", "TRY", "INR", "BRL", "KRW", "NZD", "SEK", "NOK",
    "DKK", "CZK", "ILS", "HKD", "SGD", "BTC",
  ];
  const codes = vocab.idsOf("Currency").sort((a, b) => {
    const pa = PRIORITY.indexOf(a);
    const pb = PRIORITY.indexOf(b);
    return (pa === -1 ? 999 : pa) - (pb === -1 ? 999 : pb) || a.localeCompare(b);
  });
  for (const code of codes) {
    reg.currencyCodes.add(code);
    const fmt = vocab.entryEn("Currency", `${code}.format`);
    if (fmt) reg.currencyFormat.set(code, fmt.replace("%@", "{}"));
    const variants = vocab.variants("Currency", `${code}.variants`);
    if (!variants.some((v) => v.toUpperCase() === code)) variants.push(code);
    for (const v of variants) reg.addPhrase(v, { t: "currency", code }, { caseSensitive: false });
  }

  // speed, pressure, energy, power, frequency, fuel
  for (const d of EXTRA_UNITS) {
    const unit: Unit = {
      id: d.id,
      dimension: d.dimension,
      ratio: new Decimal(d.ratio),
      ...(d.reciprocal ? { reciprocal: true } : {}),
      format: d.format,
    };
    reg.unitsById.set(unit.id, unit);
    for (const p of d.phrases.split(",")) {
      const ph = p.trim();
      if (ph) reg.addPhrase(ph, { t: "unit", unit }, { caseSensitive: false });
    }
    if (d.symbols) {
      for (const s of d.symbols.split(",")) {
        const ph = s.trim();
        if (ph) reg.addPhrase(ph, { t: "unit", unit }, { caseSensitive: true });
      }
    }
  }

  // cryptocurrencies (live prices come from the shell)
  // codes that collide with common words match case-sensitively only
  const CRYPTO_STRICT_CODES = new Set(["TON", "NEAR", "ATOM", "LINK", "UNI", "DOT", "SOL"]);
  for (const c of CRYPTO) {
    reg.currencyCodes.add(c.code);
    reg.currencyFormat.set(c.code, `{} ${c.code}`);
    reg.addPhrase(c.code, { t: "currency", code: c.code }, { caseSensitive: CRYPTO_STRICT_CODES.has(c.code) });
    for (const p of c.phrases.split(",")) {
      const ph = p.trim();
      if (ph) reg.addPhrase(ph, { t: "currency", code: c.code }, { caseSensitive: false });
    }
  }

  // autocomplete entries
  const seen = new Set<string>();
  const addCompletion = (label: string, type: Completion["type"], detail?: string) => {
    const k = `${type}:${label.toLowerCase()}`;
    if (seen.has(k) || label.length < 2 || !/^[\p{L}]/u.test(label)) return;
    seen.add(k);
    reg.completions.push({ label, type, detail });
  };
  for (const d of UNIT_DATA) {
    for (const v of vocab.variants(d.category, `${d.id}.variants`)) addCompletion(v, "unit", d.dimension);
  }
  for (const d of EXTRA_UNITS) {
    for (const v of d.phrases.split(",")) addCompletion(v.trim(), "unit", d.dimension);
  }
  for (const code of reg.currencyCodes) addCompletion(code, "currency");
  for (const f of BUILTIN_FUNCS) addCompletion(f, "function");
  for (const k of ["sum", "total", "average", "avg", "prev", "today", "tomorrow", "yesterday", "time", "now", "hex", "binary"]) {
    addCompletion(k, "keyword");
  }

  return reg;
}
