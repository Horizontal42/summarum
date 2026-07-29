import { describe, it, expect } from "vitest";
import { parseLine } from "./parser";
import { tokenize } from "./tokenizer";
import { buildRegistry } from "./registry";
import { Decimal } from "./types";

const reg = buildRegistry();

function parse(line: string, knownVars = new Set<string>()) {
  const tokens = tokenize(line, reg);
  return parseLine(tokens, knownVars, line);
}

describe("parseLine", () => {
  it("parses basic expressions", () => {
    const res = parse("2 + 2");
    expect(res.assign).toBeUndefined();
    expect(res.expr).toMatchObject({
      k: "bin",
      op: "plus",
      l: { k: "num", v: new Decimal(2) },
      r: { k: "num", v: new Decimal(2) }
    });
  });

  it("parses variable assignment with '='", () => {
    const res = parse("x = 5 + 3");
    expect(res.assign).toBe("x");
    expect(res.expr).toMatchObject({
      k: "bin",
      op: "plus",
      l: { k: "num", v: new Decimal(5) },
      r: { k: "num", v: new Decimal(3) }
    });
  });

  it("parses variable assignment with 'is'", () => {
    const res = parse("myVar is 10");
    expect(res.assign).toBe("myVar");
    expect(res.expr).toMatchObject({
      k: "num",
      v: new Decimal(10)
    });
  });

  it("rejects invalid variable names for assignment", () => {
    const res = parse("123 = 5");
    expect(res.assign).toBeUndefined();
  });

  it("handles known variables shadowing built-ins", () => {
    // "m" is normally a unit (meters), but if it's a known variable, it's treated as a word
    const res = parse("m = 5", new Set(["m"]));
    expect(res.assign).toBe("m");
    expect(res.expr).toMatchObject({
      k: "num",
      v: new Decimal(5)
    });
  });

  it("filters noise words", () => {
    // "what is 2 + 2" -> "what" and "is" are noise, leaving "2 + 2"
    const res = parse("what is 2 + 2");
    expect(res.expr).toMatchObject({
      k: "bin",
      op: "plus"
    });
  });

  it("keeps words after a conversion operator (e.g., timezones)", () => {
    // "now in Europe/Berlin"
    // "Europe/Berlin" should be kept as a timezone, not dropped as noise.
    const res = parse("now in Europe/Berlin");
    expect(res.expr).toMatchObject({
      k: "conv",
      target: {
        type: "tz"
      }
    });
  });

  it("parses goal seek expressions", () => {
    const res = parse("? * 1.2 = 1000");
    expect(res.expr).toMatchObject({
      k: "goalseek",
      lhs: { k: "bin", op: "mul", l: { k: "unknown" }, r: { k: "num", v: new Decimal(1.2) } },
      rhs: { k: "num", v: new Decimal(1000) }
    });
  });

  it("returns null expression for empty or noise-only lines", () => {
    const res = parse("just some noise");
    expect(res.expr).toBeNull();
  });
});
