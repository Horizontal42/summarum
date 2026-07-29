import { describe, it, expect, beforeAll } from "vitest";
import { tokenize } from "./tokenizer";
import { buildRegistry, Registry } from "./registry";

describe("tokenizer", () => {
  let reg: Registry;

  beforeAll(() => {
    reg = buildRegistry();
  });

  it("tokenizes numbers and basic operators", () => {
    const tokens = tokenize("1 + 2 * 3.5 - 4 / 2 ^ 3", reg);
    expect(tokens.map(t => t.t)).toEqual([
      "num", "op", "num", "op", "num", "op", "num", "op", "num", "op", "num"
    ]);
  });

  it("handles dates", () => {
    const tokens = tokenize("2024-01-01 + 5 days", reg);
    expect(tokens[0].t).toBe("datelit");
    expect(tokens.map(t => t.t)).toEqual(["datelit", "op", "num", "unit"]);
  });

  it("handles xrefs", () => {
    const tokens = tokenize("@Sheet.key", reg);
    expect(tokens[0].t).toBe("xref");
    if (tokens[0].t === "xref") {
      expect(tokens[0].sheet).toBe("Sheet");
      expect(tokens[0].key).toBe("key");
    }
  });

  it("handles bitwise operators", () => {
    const tokens = tokenize("5 << 1 >> 2 & 3 | 4", reg);
    const typesAndOps = tokens.map(t => t.t === "bitop" ? `bitop:${t.op}` : t.t);
    expect(typesAndOps).toEqual([
      "num", "bitop:shl", "num", "bitop:shr", "num", "bitop:band", "num", "bitop:bor", "num"
    ]);
  });

  it("handles registry matches like units and currencies", () => {
    const tokens = tokenize("100 USD to EUR", reg);
    const types = tokens.map(t => t.t);
    expect(types).toEqual(["num", "currency", "conv", "currency"]);
  });

  it("disambiguates 'in' as inches", () => {
    const tokens = tokenize("5 ft 4 in in cm", reg);
    expect(tokens.map(t => t.t)).toEqual(["num", "unit", "num", "unit", "conv", "unit"]);
    if (tokens[3].t === "unit") {
      expect(tokens[3].unit.id).toBe("inch");
    }
  });

  it("does not disambiguate 'in' when it is not inches", () => {
    const tokens = tokenize("in cm", reg);
    expect(tokens.map(t => t.t)).toEqual(["conv", "unit"]);
  });

  it("handles other registry constructs (funcs, aggs, etc)", () => {
    const tokens = tokenize("sum(1, 2) + sin(pi) %", reg);
    expect(tokens.map(t => t.t)).toEqual([
      "agg", "lparen", "num", "junk", "num", "rparen", "op", "func", "lparen", "const", "rparen", "percent"
    ]);
  });

  it("handles scale and repr", () => {
    const tokens = tokenize("1M in hex", reg);
    expect(tokens.map(t => t.t)).toEqual(["num", "scale", "conv", "repr"]);
  });

  it("handles pctop and date words", () => {
    const tokens = tokenize("5% of 100 today", reg);
    expect(tokens.map(t => t.t)).toEqual(["num", "percent", "pctop", "num", "date"]);
  });

  it("handles bang, semicolon, unknown", () => {
    const tokens = tokenize("! ; ?", reg);
    expect(tokens.map(t => t.t)).toEqual(["bang", "semicolon", "unknown"]);
  });

  it("handles special tokens", () => {
    const tokens = tokenize("unix date", reg);
    expect(tokens.map(t => t.t)).toEqual(["special", "special"]);
  });

  it("handles assign", () => {
    const tokens = tokenize("x = 5", reg);
    expect(tokens.map(t => t.t)).toEqual(["word", "assign", "num"]);
  });
});
