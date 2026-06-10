// Turns values into display strings: unit/currency formats plus
// precision and grouping settings.
import { Decimal, EngineSettings, Value } from "./types";

function group(intPart: string, sep: string): string {
  if (!sep) return intPart;
  const neg = intPart.startsWith("-");
  const digits = neg ? intPart.slice(1) : intPart;
  if (digits.length < 4) return intPart;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  return (neg ? "-" : "") + grouped;
}

export function formatNumber(v: Decimal, s: EngineSettings): string {
  const rounded = v.toDecimalPlaces(s.precision);
  const str = rounded.toString();
  if (str.includes("e") || str.includes("E")) return str;
  const [int, frac] = str.split(".");
  const intG = group(int, s.groupSeparator);
  return frac !== undefined ? intG + s.decimalSeparator + frac : intG;
}

export function formatValue(v: Value, s: EngineSettings): string {
  if (v.kind === "percent") {
    return formatNumber(v.value, s) + "%";
  }

  if (v.kind === "date") {
    const opts: Intl.DateTimeFormatOptions = { timeZone: v.timeZone };
    if (v.timeOnly) {
      return new Intl.DateTimeFormat(undefined, { ...opts, hour: "2-digit", minute: "2-digit", hour12: false }).format(v.ms);
    }
    if (v.hasTime) {
      return new Intl.DateTimeFormat(undefined, {
        ...opts, hour: "2-digit", minute: "2-digit", hour12: false,
        day: "numeric", month: "short", year: "numeric",
      }).format(v.ms);
    }
    return new Intl.DateTimeFormat(undefined, { ...opts, day: "numeric", month: "long", year: "numeric" }).format(v.ms);
  }

  // quantity
  if (v.repr === "hex" || v.repr === "binary" || v.repr === "octal") {
    const int = v.value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    const neg = int.isNegative();
    const abs = int.abs();
    const prefix = v.repr === "hex" ? "0x" : v.repr === "binary" ? "0b" : "0o";
    const radix = v.repr === "hex" ? 16 : v.repr === "binary" ? 2 : 8;
    const digits = BigInt(abs.toFixed(0)).toString(radix);
    return (neg ? "-" : "") + prefix + (v.repr === "hex" ? digits.toUpperCase() : digits);
  }
  if (v.repr === "scientific") {
    return v.value.toExponential(Math.min(s.precision, 10)).replace(/e\+?/, "e");
  }
  if (v.repr === "plain") {
    return v.value.toString(); // no grouping (unix timestamps)
  }
  if (v.repr === "fraction") {
    return formatFraction(v.value);
  }
  if (v.repr === "roman") {
    return formatRoman(v.value) ?? formatNumber(v.value, s);
  }

  const num = formatNumber(v.value, s);
  if (!v.unit) return num;
  return withUnit(num, v.unit.format);
}

function withUnit(num: string, f: string): string {
  if (f.includes("{}")) {
    return f.replace("{}", num); // currency template
  }
  // suffix units: letters get a space ("12.7 cm"), symbols attach ("5″", "25°C")
  return /^[\p{L}]/u.test(f) && !f.startsWith("°") ? `${num} ${f}` : `${num}${f}`;
}

/** Best rational approximation via continued fractions: 0.75 -> "3/4". */
function formatFraction(v: Decimal): string {
  const neg = v.isNegative();
  const x = v.abs().toNumber();
  if (!Number.isFinite(x)) return v.toString();
  let h1 = 1, h0 = 0, k1 = 0, k0 = 1, b = x;
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(b);
    [h1, h0] = [a * h1 + h0, h1];
    [k1, k0] = [a * k1 + k0, k1];
    if (k1 > 10000) break;
    if (Math.abs(x - h1 / k1) < 1e-12) break;
    const frac = b - a;
    if (frac < 1e-12) break;
    b = 1 / frac;
  }
  const sign = neg ? "-" : "";
  if (k1 === 1) return sign + String(h1);
  const whole = Math.floor(h1 / k1);
  const rem = h1 - whole * k1;
  return whole > 0 ? `${sign}${whole} ${rem}/${k1}` : `${sign}${rem}/${k1}`;
}

function formatRoman(v: Decimal): string | null {
  if (!v.isInteger() || v.lt(1) || v.gt(3999)) return null;
  let n = v.toNumber();
  const table: Array<[number, string]> = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  for (const [val, sym] of table) {
    while (n >= val) {
      out += sym;
      n -= val;
    }
  }
  return out;
}
