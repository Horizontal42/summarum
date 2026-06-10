// Public facade: evaluates whole documents line by line and exposes the
// extension API (numi.addUnit / addFunction / setVariable).
import { Decimal, EngineSettings, EvalError, Quantity, Unit, Value, defaultSettings, qty } from "./types";
import { Registry, buildRegistry, Completion } from "./registry";
import { tokenize, Token } from "./tokenizer";
import { parseLine } from "./parser";
import { evaluate, EvalCtx, toBase, fromBase } from "./evaluator";
import { formatValue } from "./formatter";
import snapshot from "./rates-snapshot.json";
import { CRYPTO } from "./extraunits";

const cryptoSnapshot: Record<string, number> = {};
for (const c of CRYPTO) cryptoSnapshot[c.code] = 1 / c.snapshotUsd;

export interface LineResult {
  /** formatted result, null when the line has none (text, comment, header, error) */
  text: string | null;
  value: Value | null;
  kind: "empty" | "header" | "comment" | "normal";
  /** tokens, for syntax highlighting */
  tokens: Token[];
  /** offset of "//" comment start within the line, if any */
  commentStart: number | null;
}

export interface ExtensionUnitSpec {
  id: string;
  phrases: string;
  baseUnitId: string;
  format?: string;
  ratio: number;
}

export interface ExtensionValue {
  double: number;
  unitId?: string;
}

export class SumEngine {
  reg: Registry;
  settings: EngineSettings;
  /** variables defined by extensions, persist across evaluations */
  private globals = new Map<string, Value>();

  constructor(settings: Partial<EngineSettings> = {}) {
    this.settings = { ...defaultSettings, ...settings };
    this.reg = buildRegistry();
    this.reg.setRates({ ...snapshot.rates, ...cryptoSnapshot });
  }

  setRates(rates: Record<string, number | string>): void {
    // snapshot fills codes the live API doesn't return (e.g. crypto when CoinGecko fails)
    this.reg.setRates({ ...snapshot.rates, ...cryptoSnapshot, ...rates });
  }

  updateSettings(patch: Partial<EngineSettings>): void {
    this.settings = { ...this.settings, ...patch };
  }

  completions(): Completion[] {
    return this.reg.completions;
  }

  evaluateDocument(text: string): LineResult[] {
    const lines = text.split("\n");
    const results: LineResult[] = [];
    const vars = new Map<string, Value>(this.globals);
    const lineValues: (Value | null)[] = [];
    const lineKinds: ("empty" | "header" | "normal")[] = [];

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const commentStart = rawLine.indexOf("//");
      const line = commentStart >= 0 ? rawLine.slice(0, commentStart) : rawLine;
      const trimmed = line.trim();

      if (trimmed.length === 0) {
        const kind = commentStart >= 0 ? "comment" : "empty";
        results.push({ text: null, value: null, kind, tokens: [], commentStart: commentStart >= 0 ? commentStart : null });
        lineValues.push(null);
        lineKinds.push("empty");
        continue;
      }
      if (trimmed.startsWith("#")) {
        results.push({ text: null, value: null, kind: "header", tokens: [], commentStart: commentStart >= 0 ? commentStart : null });
        lineValues.push(null);
        lineKinds.push("header");
        continue;
      }

      const tokens = tokenize(line, this.reg);
      const knownVars = new Set(vars.keys());
      const parsed = parseLine(tokens, knownVars);

      let value: Value | null = null;
      if (parsed.expr) {
        const ctx: EvalCtx = {
          reg: this.reg,
          vars,
          line: { lineValues, lineKinds, index: i },
        };
        try {
          value = evaluate(parsed.expr, ctx);
          if (parsed.assign) vars.set(parsed.assign, value);
        } catch (e) {
          if (!(e instanceof EvalError)) throw e;
          value = null;
        }
      }

      lineValues.push(value);
      lineKinds.push("normal");
      results.push({
        text: value ? formatValue(value, this.settings) : null,
        value,
        kind: "normal",
        tokens,
        commentStart: commentStart >= 0 ? commentStart : null,
      });
    }
    return results;
  }

  /** Evaluate a single expression (used by the extension runtime and tests). */
  evaluateExpression(text: string): Value | null {
    const r = this.evaluateDocument(text);
    return r[r.length - 1]?.value ?? null;
  }

  /**
   * Grand total of the sheet for the status bar: sums every line result
   * compatible with the first united result's dimension (converted to its
   * unit). Returns null when fewer than two lines contribute.
   */
  totalOf(results: LineResult[]): string | null {
    const qs = results
      .map((r) => r.value)
      .filter((v): v is Quantity => v !== null && v.kind === "quantity");
    if (qs.length < 2) return null;
    const anchor = qs.find((q) => q.unit) ?? qs[0];
    let acc = new Decimal(0);
    let count = 0;
    for (const q of qs) {
      if (anchor.unit && q.unit && q.unit.dimension === anchor.unit.dimension) {
        acc = acc.add(toBase(q));
        count++;
      } else if (!anchor.unit && !q.unit) {
        acc = acc.add(q.value);
        count++;
      }
    }
    if (count < 2) return null;
    const value = anchor.unit ? fromBase(acc, anchor.unit) : acc;
    return formatValue(qty(value, anchor.unit ?? null), this.settings);
  }

  // ---------- extension API (numi.*)

  setVariable(name: string, value: number | ExtensionValue): void {
    this.globals.set(name, this.toValue(value));
  }

  addUnit(spec: ExtensionUnitSpec): void {
    const base = this.reg.unitsById.get(spec.baseUnitId) ?? this.currencyBase(spec.baseUnitId);
    if (!base) throw new Error(`numi.addUnit: unknown baseUnitId ${spec.baseUnitId}`);
    const unit: Unit = {
      id: spec.id,
      dimension: base.dimension,
      ratio: base.ratio.mul(spec.ratio),
      ...(base.offset ? { offset: base.offset } : {}),
      format: spec.format ?? spec.id,
    };
    this.reg.unitsById.set(unit.id, unit);
    for (const p of spec.phrases.split(",")) {
      const phrase = p.trim();
      if (phrase) this.reg.addPhrase(phrase, { t: "unit", unit }, { caseSensitive: false });
    }
    this.reg.completions.push({ label: spec.id, type: "unit", detail: "extension" });
  }

  addFunction(spec: { id: string; phrases: string }, fn: (values: ExtensionValue[]) => ExtensionValue | number): void {
    const name = spec.id;
    this.reg.customFuncs.set(name, (args: Value[]) => {
      const mapped = args.map((a) => this.fromValue(a));
      return this.toValue(fn(mapped));
    });
    for (const p of (spec.phrases || spec.id).split(",")) {
      const phrase = p.trim();
      if (phrase) this.reg.addPhrase(phrase, { t: "func", name }, { caseSensitive: false });
    }
    this.reg.completions.push({ label: name, type: "function", detail: "extension" });
  }

  private currencyBase(code: string): Unit | null {
    return this.reg.currencyCodes.has(code) ? this.reg.makeCurrencyUnit(code) : null;
  }

  private toValue(v: number | ExtensionValue): Value {
    if (typeof v === "number") return qty(v);
    const unit = v.unitId
      ? this.reg.unitsById.get(v.unitId) ?? this.currencyBase(v.unitId) ?? null
      : null;
    return qty(new Decimal(v.double), unit);
  }

  private fromValue(v: Value): ExtensionValue {
    if (v.kind === "quantity") {
      return { double: v.value.toNumber(), ...(v.unit ? { unitId: v.unit.id } : {}) };
    }
    if (v.kind === "percent") return { double: v.value.div(100).toNumber() };
    return { double: v.ms };
  }
}

export { formatValue } from "./formatter";
export type { Value, EngineSettings } from "./types";
export type { Token } from "./tokenizer";
