import { describe, it, expect, beforeAll } from "vitest";
import { SumEngine } from "./index";
import { qty } from "./types";
import type { XRefResolution } from "./evaluator";
import { formatValue } from "./index";

let eng: SumEngine;

beforeAll(() => {
  eng = new SumEngine();
  // deterministic rates for tests
  eng.setRates({ USD: 1, EUR: 0.5, RUB: 100, GBP: 0.25, BTC: 0.00001 });
});

function calc(expr: string): string | null {
  const r = eng.evaluateDocument(expr);
  return r[r.length - 1].text;
}

function calcDoc(doc: string): (string | null)[] {
  return eng.evaluateDocument(doc).map((r) => r.text);
}

describe("arithmetic", () => {
  it("basic ops", () => {
    expect(calc("2 + 2")).toBe("4");
    expect(calc("7 - 10")).toBe("-3");
    expect(calc("6 * 7")).toBe("42");
    expect(calc("1 / 8")).toBe("0.13");
    expect(calc("2 ^ 10")).toBe("1,024");
    expect(calc("10 mod 3")).toBe("1");
    expect(calc("5!")).toBe("120");
  });
  it("decimal precision (no float artifacts)", () => {
    expect(calc("0.1 + 0.2")).toBe("0.3");
  });
  it("parens and precedence", () => {
    expect(calc("2 + 3 * 4")).toBe("14");
    expect(calc("(2 + 3) * 4")).toBe("20");
    expect(calc("2(3+4)")).toBe("14");
  });
  it("word operators", () => {
    expect(calc("5 plus 3")).toBe("8");
    expect(calc("10 minus 4")).toBe("6");
    expect(calc("3 times 4")).toBe("12");
    expect(calc("20 divided by 4")).toBe("5");
    expect(calc("5 и 3")).toBe("8"); // ru plus
  });
  it("thousands separators in input", () => {
    expect(calc("1,000 + 234")).toBe("1,234");
  });
  it("scales", () => {
    expect(calc("1.5 million")).toBe("1,500,000");
    expect(calc("5k")).toBe("5,000");
    expect(calc("2 trillion")).toBe("2,000,000,000,000");
    expect(calc("1.5 трлн")).toBe("1,500,000,000,000");
    expect(calc("5к")).toBe("5,000");
    expect(calc("5кк")).toBe("5,000,000");
    expect(calc("2ккк")).toBe("2,000,000,000");
    expect(calc("2 dozen")).toBe("2"); // dozen is not in the vocab — noise
  });
  it("free text around math is ignored", () => {
    expect(calc("I spent 20 on pizza plus 5 on coffee")).toBe("25");
  });
  it("constants", () => {
    expect(calc("pi * 2")).toBe("6.28");
  });
  it("functions", () => {
    expect(calc("sqrt(16)")).toBe("4");
    expect(calc("sqrt 16")).toBe("4");
    expect(calc("square root of 16")).toBe("4");
    expect(calc("cbrt(27)")).toBe("3");
    expect(calc("abs(-5)")).toBe("5");
    expect(calc("round(2.6)")).toBe("3");
    expect(calc("log(1000)")).toBe("3");
    expect(calc("ln(1)")).toBe("0");
    // russian aliases
    expect(calc("квадратный корень из 16")).toBe("4");
    expect(calc("кубический корень из 27")).toBe("3");
    expect(calc("модуль(-5)")).toBe("5");
    expect(calc("логарифм(1000)")).toBe("3");
    expect(calc("натуральный логарифм(1)")).toBe("0");
    expect(calc("округлить(2.6)")).toBe("3");
  });
  it("fraction constants", () => {
    expect(calc("a half")).toBe("0.5");
    expect(calc("one half")).toBe("0.5");
    expect(calc("половина")).toBe("0.5");
    expect(calc("a half million")).toBe("500,000");
    expect(calc("one and a half")).toBe("1.5");
    expect(calc("полтора")).toBe("1.5");
    expect(calc("полтора миллиона")).toBe("1,500,000");
    expect(calc("полторы тысячи")).toBe("1,500");
  });
});

describe("percent", () => {
  it("sample: 8 / (45 - 20%)", () => {
    expect(calc("8 / (45 - 20%)")).toBe("0.22");
  });
  it("plus/minus percent", () => {
    expect(calc("100 + 20%")).toBe("120");
    expect(calc("100 - 20%")).toBe("80");
  });
  it("of / off / on", () => {
    expect(calc("20% of 100")).toBe("20");
    expect(calc("20% off 100")).toBe("80");
    expect(calc("20% on 100")).toBe("120");
  });
  it("as a % of", () => {
    expect(calc("5 as a % of 25")).toBe("20%");
  });
  it("of what is", () => {
    expect(calc("20% of what is 30")).toBe("150");
    expect(calc("25% off what is 60")).toBe("80");
  });
  it("percent arithmetic", () => {
    expect(calc("5% + 5%")).toBe("10%");
    expect(calc("100 * 20%")).toBe("20");
  });
});

describe("units", () => {
  it("sample: 5 inches in cm", () => {
    expect(calc("5 inches in cm")).toBe("12.7 cm");
  });
  it("length", () => {
    expect(calc("1 mile in km")).toBe("1.61 km");
    expect(calc("100 km in miles")).toBe("62.14 mi.");
    expect(calc("6 feet in meters")).toBe("1.83 m");
  });
  it("prefixed symbols", () => {
    expect(calc("10 mm in cm")).toBe("1 cm");
    expect(calc("1 km in m")).toBe("1,000 m");
  });
  it("weight", () => {
    expect(calc("1 kg in pounds")).toBe("2.2 lb");
    expect(calc("16 oz in pounds")).toBe("1 lb");
  });
  it("temperature", () => {
    expect(calc("100 C in F")).toBe("212°F");
    expect(calc("32 F in C")).toBe("0°C");
    expect(calc("0 C in K")).toBe("273.15 K");
  });
  it("volume", () => {
    expect(calc("1 gallon in liters")).toBe("3.79 L");
  });
  it("area", () => {
    expect(calc("1 hectare in acres")).toBe("2.47 acre");
    expect(calc("2 m * 3 m")).toBe("6 m²");
  });
  it("data with SI and IEC prefixes", () => {
    expect(calc("1 GB in MB")).toBe("1,000 MB");
    expect(calc("1 GiB in MiB")).toBe("1,024 MiB");
    expect(calc("1 GB in MiB")).toBe("953.67 MiB");
    expect(calc("1 byte in bits")).toBe("8 b");
  });
  it("css", () => {
    expect(calc("32 px in em")).toBe("2 em");
    expect(calc("1 inch in px")).toBe("96 px");
  });
  it("time units", () => {
    expect(calc("90 minutes in hours")).toBe("1.5 h");
    expect(calc("2 hours 30 minutes in minutes")).toBe("150 min");
  });
  it("unit math keeps the left unit", () => {
    expect(calc("1 m + 50 cm")).toBe("1.5 m");
    expect(calc("5 ft 4 in in cm")).toBe("162.56 cm");
  });
  it("angle trig", () => {
    expect(calc("sin(90 degrees)")).toBe("1");
  });
  it("russian unit phrases", () => {
    expect(calc("5 метров в см")).toBe("500 cm");
  });
});

describe("currency", () => {
  it("sample: $9 in Euro (test rate 1 USD = 0.5 EUR)", () => {
    expect(calc("$9 in Euro")).toBe("€ 4.5");
  });
  it("postfix and codes", () => {
    expect(calc("100 USD in RUB")).toBe("10,000 ₽");
    expect(calc("100 рублей в долларах")).toBe("$1");
  });
  it("currency arithmetic", () => {
    expect(calc("$10 + $5")).toBe("$15");
    expect(calc("$10 + 20%")).toBe("$12");
  });
  it("GBP↔RUB via natural phrases", () => {
    // "sterling" and "quid" as English shortcuts (bare "pounds" is weight, not GBP)
    expect(calc("100 sterling in RUB")).toBe("40,000 ₽");
    expect(calc("100 quid in rubles")).toBe("40,000 ₽");
    // Russian: "стерлинг" (bare "фунт" is weight unit, not GBP)
    expect(calc("100 стерлингов в рублях")).toBe("40,000 ₽");
    // existing multi-word forms still work
    expect(calc("100 GBP in RUB")).toBe("40,000 ₽");
    expect(calc("£100 in RUB")).toBe("40,000 ₽");
  });
});

describe("numeral systems", () => {
  it("input", () => {
    expect(calc("0x1F")).toBe("0x1F");
    expect(calc("0b101 in decimal")).toBe("5");
  });
  it("conversion", () => {
    expect(calc("255 in hex")).toBe("0xFF");
    expect(calc("5 in binary")).toBe("0b101");
    expect(calc("8 in octal")).toBe("0o10");
  });
  it("hex arithmetic keeps repr of the left operand", () => {
    expect(calc("0x10 + 0x10 in decimal")).toBe("32");
  });
});

describe("variables and document context", () => {
  it("assignment and reuse", () => {
    expect(calcDoc("x = 5\nx * 2")).toEqual(["5", "10"]);
  });
  it("is-assignment", () => {
    expect(calcDoc("price is 100\nprice + 20%")).toEqual(["100", "120"]);
  });
  it("sum / total", () => {
    expect(calcDoc("10\n20\n30\nsum")).toEqual(["10", "20", "30", "60"]);
    expect(calcDoc("10\n20\n\n30\nsum")).toEqual(["10", "20", null, "30", "30"]);
  });
  it("sum with units", () => {
    expect(calcDoc("$10\n$20\ntotal")).toEqual(["$10", "$20", "$30"]);
  });
  it("avg", () => {
    expect(calcDoc("10\n20\naverage")).toEqual(["10", "20", "15"]);
  });
  it("prev", () => {
    expect(calcDoc("42\nprev + 1")).toEqual(["42", "43"]);
  });
  it("count", () => {
    expect(calcDoc("10\n20\n30\ncount")).toEqual(["10", "20", "30", "3"]);
    expect(calcDoc("10\n20\n\n30\ncount")).toEqual(["10", "20", null, "30", "1"]);
  });
  it("min / max", () => {
    expect(calcDoc("10\n20\n5\nmin")).toEqual(["10", "20", "5", "5"]);
    expect(calcDoc("10\n20\n5\nmax")).toEqual(["10", "20", "5", "20"]);
  });
  it("min / max with units", () => {
    expect(calcDoc("10 m\n5 m\n20 m\nmin")).toEqual(["10 m", "5 m", "20 m", "5 m"]);
    expect(calcDoc("10 m\n5 m\n20 m\nmax")).toEqual(["10 m", "5 m", "20 m", "20 m"]);
  });
  it("product", () => {
    expect(calcDoc("2\n3\n4\nproduct")).toEqual(["2", "3", "4", "24"]);
  });
  it("random — deterministic per line text", () => {
    const [a] = calcDoc("random(1, 6)");
    const [b] = calcDoc("random(1, 6)");
    expect(a).toBe(b); // same text → same seed → same result
    const [c] = calcDoc("random(1, 6) ");
    expect(c).not.toBe(a); // different text → different seed
  });
  it("random — stays in range", () => {
    const v = Number(calc("random(1, 100)"));
    expect(v).toBeGreaterThanOrEqual(1);
    expect(v).toBeLessThanOrEqual(100);
  });
  it("headers split blocks and produce no result", () => {
    expect(calcDoc("# Food\n10\n20\nsum")).toEqual([null, "10", "20", "30"]);
  });
  it("comments", () => {
    expect(calcDoc("// just a comment\n5 + 5 // inline")).toEqual([null, "10"]);
  });
  it("label lines produce no result", () => {
    expect(calc("Monthly costs")).toBe(null);
  });
});

describe("dates", () => {
  it("today + 2 weeks lands 14 days ahead", () => {
    const r = eng.evaluateDocument("today + 2 weeks - today");
    // (today + 2w) - today = 14 days
    expect(r[0].text).toBe("14 day");
  });
  it("tomorrow - today = 1 day", () => {
    expect(calc("tomorrow - today")).toBe("1 day");
  });
  it("time in a timezone returns a formatted time", () => {
    const t = calc("time in Tokyo");
    expect(t).toMatch(/^\d{2}:\d{2}$/);
  });
  it("ISO date literal produces a formatted date", () => {
    const r = calc("2024-01-01");
    expect(r).not.toBeNull();
    expect(typeof r).toBe("string");
  });
  it("ISO date subtraction: 2026-01-01 - 2024-01-01 = 731 days", () => {
    expect(calc("2026-01-01 - 2024-01-01")).toBe("731 day");
  });
  it("days until future date returns positive days", () => {
    const r = calc("days until 2099-01-01");
    expect(r).not.toBeNull();
    expect(Number(r!.replace(/[^\d.-]/g, ""))).toBeGreaterThan(0);
  });
  it("days since past date returns positive days", () => {
    const r = calc("days since 2000-01-01");
    expect(r).not.toBeNull();
    expect(Number(r!.replace(/[^\d.-]/g, ""))).toBeGreaterThan(0);
  });
});

describe("historical rates", () => {
  it("in EUR on date uses injected historical rate", () => {
    eng.setHistoricalRates("2024-01-01", { EUR: 0.9, USD: 1 });
    expect(calc("1000 USD in EUR on 2024-01-01")).toBe("€ 900");
  });
  it("missing historical date returns null", () => {
    expect(calc("500 USD in EUR on 1800-01-01")).toBeNull();
  });
});

describe("goal seek", () => {
  it("? * 1.2 = 1000", () => expect(calc("? * 1.2 = 1000")).toBe("833.33"));
  it("? + 50 = 200", () => expect(calc("? + 50 = 200")).toBe("150"));
  it("100 - ? = 30", () => expect(calc("100 - ? = 30")).toBe("70"));
  it("? / 4 = 5", () => expect(calc("? / 4 = 5")).toBe("20"));
  it("? - ? = 5 has no solution", () => expect(calc("? - ? = 5")).toBeNull());
});

describe("extension API", () => {
  it("addUnit (horse from Sample.js)", () => {
    eng.addUnit({ id: "horse", phrases: "horse, horses, hrs", baseUnitId: "meter", format: "hrs", ratio: 2.4 });
    expect(calc("2 horses in meters")).toBe("4.8 m");
  });
  it("addFunction (zum from Sample.js)", () => {
    eng.addFunction({ id: "zum", phrases: "zum" }, (values) => ({ double: values[0].double + values[1].double }));
    expect(calc("zum(2;3)")).toBe("5");
  });
  it("setVariable", () => {
    eng.setVariable("myvar", { double: 5, unitId: "USD" });
    expect(calc("myvar * 2")).toBe("$10");
  });
});

function calcWithResolver(
  expr: string,
  resolver: (sheet: string, key: string) => XRefResolution,
): string | null {
  const r = eng.evaluateDocument(expr, resolver);
  return r[r.length - 1].text;
}

describe("grand total", () => {
  it("totalValueOf's raw value formats identically to totalOf's string", () => {
    const results = eng.evaluateDocument("$100\n$50");
    const raw = eng.totalValueOf(results);
    expect(raw).not.toBeNull();
    expect(formatValue(raw!, eng.settings)).toBe(eng.totalOf(results));
  });
});

describe("cross-sheet references", () => {
  function resolver(sheet: string, key: string): XRefResolution {
    const s = sheet.toLowerCase();
    if (s === "budget") {
      if (key === "total") return { ok: true, value: qty(150) };
      if (key === "rent") return { ok: true, value: qty(500, eng.reg.unitsById.get("meter")!) };
      if (key === "last") return { ok: true, value: qty(7) };
      return { ok: false, reason: `no variable "${key}" in "${sheet}"` };
    }
    if (s === "trip to lisbon") {
      if (key === "food") return { ok: true, value: qty(25) };
      return { ok: false, reason: `no variable "${key}" in "${sheet}"` };
    }
    return { ok: false, reason: `sheet "${sheet}" not found` };
  }

  it("resolves @Sheet.total", () => {
    expect(calcWithResolver("@Budget.total", resolver)).toBe("150");
  });
  it("resolves @Sheet.var and participates in arithmetic", () => {
    expect(calcWithResolver("@Budget.rent + 1 m", resolver)).toBe("501 m");
  });
  it("resolves @Sheet.last", () => {
    expect(calcWithResolver("@Budget.last", resolver)).toBe("7");
  });
  it("unit conversion over a resolved reference", () => {
    expect(calcWithResolver("@Budget.rent in cm", resolver)).toBe("50,000 cm");
  });
  it("bracket form for titles with spaces", () => {
    expect(calcWithResolver("@[Trip to Lisbon].food", resolver)).toBe("25");
  });
  it("unresolved sheet sets a line error instead of crashing", () => {
    const r = eng.evaluateDocument("@Nope.total", resolver);
    expect(r[0].value).toBeNull();
    expect(r[0].error).toBe('sheet "Nope" not found');
  });
  it("unresolved key sets a line error", () => {
    const r = eng.evaluateDocument("@Budget.nope", resolver);
    expect(r[0].value).toBeNull();
    expect(r[0].error).toBe('no variable "nope" in "Budget"');
  });
  it("propagates a resolver-reported circular reference", () => {
    const cyc = (): XRefResolution => ({ ok: false, reason: "circular reference" });
    const r = eng.evaluateDocument("@A.total", cyc);
    expect(r[0].value).toBeNull();
    expect(r[0].error).toBe("circular reference");
  });
  it("no resolver given: resolves to null without throwing", () => {
    expect(() => eng.evaluateDocument("@Budget.total")).not.toThrow();
    const r = eng.evaluateDocument("@Budget.total");
    expect(r[0].value).toBeNull();
    expect(r[0].error).toBe('sheet "Budget" not found');
  });
  it("an assignment line reports the assigned name via LineResult.assign", () => {
    const r = eng.evaluateDocument("rent = $500");
    expect(r[0].assign).toBe("rent");
  });
});
