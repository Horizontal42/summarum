import { describe, it, expect, beforeAll } from "vitest";
import { SumEngine } from "./index";

let eng: SumEngine;

beforeAll(() => {
  eng = new SumEngine();
  eng.setRates({ USD: 1, EUR: 0.5, RUB: 100, GBP: 0.25 });
});

function calc(expr: string): string | null {
  const r = eng.evaluateDocument(expr);
  return r[r.length - 1].text;
}

describe("edge cases", () => {
  it("russian mixed sentence", () => {
    expect(calc("потратил 20$ и ещё 5$")).toBe("$25");
  });
  it("russian conversion to currency", () => {
    expect(calc("20$ в рублях")).toBe("2,000 ₽");
  });
  it("generic 'доллар' means USD, not TTD", () => {
    expect(calc("1 доллар")).toBe("$1");
    expect(calc("1 доллар в рублях")).toBe("100 ₽");
  });
  it("chained percent discounts", () => {
    expect(calc("100 - 10% - 10%")).toBe("81");
  });
  it("conversion chain", () => {
    expect(calc("1 km in m in cm")).toBe("100,000 cm");
  });
  it("euro symbol", () => {
    expect(calc("€10 + €5")).toBe("€ 15");
  });
  it("pow precedence", () => {
    expect(calc("2 * 3^2")).toBe("18");
    expect(calc("-2^2")).toBe("-4");
  });
  it("last expression wins for unrelated numbers", () => {
    expect(calc("page 10 results 2 + 3")).toBe("5");
  });
  it("empty and label lines give no result", () => {
    expect(calc("")).toBe(null);
    expect(calc("hello world")).toBe(null);
  });
  it("sum stops at header", () => {
    const r = eng.evaluateDocument("5\n# section\n10\n20\nsum").map((x) => x.text);
    expect(r).toEqual(["5", null, "10", "20", "30"]);
  });
  it("variables with units survive math", () => {
    const r = eng.evaluateDocument("rent = $500\nfood = $200\nrent + food").map((x) => x.text);
    expect(r).toEqual(["$500", "$200", "$700"]);
  });
  it("big numbers with grouping", () => {
    expect(calc("1000000 * 2")).toBe("2,000,000");
  });
  it("division by zero yields no result", () => {
    expect(calc("5 / 0")).toBe(null);
  });
  it("trailing garbage does not break expression", () => {
    expect(calc("2 + 2 =")).toBe("4");
  });
  it("scientific output", () => {
    expect(calc("123456 in scientific")).toBe("1.23e5"); // mantissa follows precision setting
  });
  it("GiB in GB", () => {
    expect(calc("1 GiB in GB")).toBe("1.07 GB");
  });
  it("Kelvin word", () => {
    expect(calc("300 kelvin in celsius")).toBe("26.85°C");
  });
  it("milliseconds", () => {
    expect(calc("1500 ms in seconds")).toBe("1.5 s");
  });
  it("square meters word form", () => {
    expect(calc("3 square meters in sq ft")).toBe("32.29 ft²");
  });
  it("multiplication of money by count", () => {
    expect(calc("$12 * 3")).toBe("$36");
  });
});

describe("extra units", () => {
  it("speed", () => {
    expect(calc("100 km/h in mph")).toBe("62.14 mph");
    expect(calc("60 mph in km/h")).toBe("96.56 km/h");
    expect(calc("10 m/s in km/h")).toBe("36 km/h");
  });
  it("pressure", () => {
    expect(calc("1 atm in mmHg")).toBe("760 mmHg");
    expect(calc("2 bar in psi")).toBe("29.01 psi");
  });
  it("energy", () => {
    expect(calc("1 kwh in kJ")).toBe("3,600 kJ");
    expect(calc("500 kcal in kJ")).toBe("2,092 kJ");
  });
  it("power", () => {
    expect(calc("150 hp in kW")).toBe("111.85 kW");
    expect(calc("100 лс в kW")).toBe("73.55 kW");
  });
  it("frequency", () => {
    expect(calc("3000 rpm in Hz")).toBe("50 Hz");
  });
  it("fuel (reciprocal mpg)", () => {
    expect(calc("8 l/100km in mpg")).toBe("29.4 mpg");
    expect(calc("30 mpg in l/100km")).toBe("7.84 L/100km");
  });
});

describe("bitwise and unix", () => {
  it("bit ops", () => {
    expect(calc("0xF0 | 0x0F")).toBe("0xFF");
    expect(calc("0xFF & 0x0F")).toBe("0xF");
    expect(calc("5 xor 3")).toBe("6");
    expect(calc("1 << 4")).toBe("16");
    expect(calc("1 shl 4")).toBe("16");
    expect(calc("256 >> 4")).toBe("16");
  });
  it("unix timestamps", () => {
    expect(calc("today in unix")).toMatch(/^\d{10}$/);
    const r = eng.evaluateDocument("1750000000 as date");
    expect(r[0].value?.kind).toBe("date");
  });
});

describe("fraction and roman", () => {
  it("fractions", () => {
    expect(calc("0.75 in fraction")).toBe("3/4");
    expect(calc("1.5 in fraction")).toBe("1 1/2");
    expect(calc("1/3 + 1/3 in fraction")).toBe("2/3");
  });
  it("roman", () => {
    expect(calc("2026 in roman")).toBe("MMXXVI");
    expect(calc("49 in roman")).toBe("XLIX");
  });
});

describe("crypto", () => {
  it("eth via snapshot/test rates", () => {
    const r = calc("1 eth in USD");
    expect(r).toMatch(/^\$/);
  });
});

describe("regressions", () => {
  it("a broken line does not kill the document (BigInt from NaN)", () => {
    const r = eng.evaluateDocument("2+2\nasin(5) & 3\n3+3").map((x) => x.text);
    expect(r).toEqual(["4", null, "6"]);
  });
  it("non-finite results are suppressed", () => {
    expect(calc("100 / 0%")).toBe(null);
    expect(calc("asin(5)")).toBe(null);
    expect(calc("sqrt(-1)")).toBe(null);
  });
  it("arithmetic continues after a line-level conversion", () => {
    expect(calc("100 USD in EUR + 20")).toBe("€ 70"); // 50 € + 20
    expect(calc("100 USD in EUR - 20")).toBe("€ 30");
    expect(calc("100 USD in EUR * 2")).toBe("€ 100");
    expect(calc("1 km in m + 1")).toBe("1,001 m");
  });
  it("uppercase prefixed symbols are accepted when unambiguous", () => {
    expect(calc("5 KM in miles")).toBe("3.11 mi.");
    expect(calc("2 KG in pounds")).toBe("4.41 lb");
    expect(calc("5 КМ в метрах")).toBe("5,000 m");
  });
  it("ambiguous case stays strict: MM is not megameters", () => {
    expect(calc("5 MM in m")).toBe("5 m"); // unrecognized, bare 5 converted
  });
  it("space-grouped numbers", () => {
    expect(calc("1 000 + 234")).toBe("1,234");
    expect(calc("1 000 000 / 2")).toBe("500,000");
    expect(calc("1 000,5 + 0,5")).toBe("1,001");
  });
  it("decimal comma", () => {
    expect(calc("1,23 + 1")).toBe("2.23");
    expect(calc("0,5 * 4")).toBe("2");
    expect(calc("1,234 + 0")).toBe("1,234"); // exactly 3 digits = thousands
  });
  it("single-letter unit names can be variables", () => {
    expect(eng.evaluateDocument("m = 5\nm * 2").map((x) => x.text)).toEqual(["5", "10"]);
    expect(eng.evaluateDocument("t = 100\nt + 20%").map((x) => x.text)).toEqual(["100", "120"]);
  });
  it("tiny conversion results show significant digits, not 0", () => {
    expect(calc("1 mm in km")).toBe("0.000001 km");
    expect(calc("32 F in C")).toBe("0°C"); // conversion noise stays zero
  });
  it("log with a space is log10", () => {
    expect(calc("log 1000")).toBe("3");
    expect(calc("log2(8)")).toBe("3");
    expect(calc("log 2 + 1")).toBe("1.3");
  });
  it("percent of a percent stays a percent", () => {
    expect(calc("50% of 50%")).toBe("25%");
    expect(calc("10% off 50%")).toBe("45%");
  });
  it("percent base on the left of ^", () => {
    expect(calc("50% ^ 2")).toBe("0.25");
    expect(calc("4 ^ 50%")).toBe("2");
  });
  it("avg skips incompatible lines in the denominator", () => {
    expect(eng.evaluateDocument("10 kg\n20 kg\n5 hours\navg").map((x) => x.text)).toEqual(["10 kg", "20 kg", "5 h", "15 kg"]);
  });
  it("calendar month add clamps to month end", () => {
    const doc = eng.evaluateDocument("today + 1 month");
    const v = doc[0].value;
    expect(v?.kind).toBe("date");
  });
});
