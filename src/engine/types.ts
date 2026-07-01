import Decimal from "decimal.js";

Decimal.set({ precision: 40, toExpNeg: -9, toExpPos: 21 });

export { Decimal };

export type Dimension =
  | "scalar"
  | "length"
  | "area"
  | "volume"
  | "weight"
  | "temperature"
  | "time"
  | "angle"
  | "data"
  | "currency"
  | "speed"
  | "pressure"
  | "energy"
  | "power"
  | "frequency"
  | "fuel";

export type NumeralRepr = "decimal" | "hex" | "binary" | "octal" | "scientific" | "fraction" | "roman" | "plain";

/** A resolved unit instance attached to a value. */
export interface Unit {
  /** canonical id, e.g. "meter", "kilo:meter", "USD", "sq:foot" */
  id: string;
  dimension: Dimension;
  /** multiplier to the dimension's base unit (meter, m², m³, gram, second, radian, bit, K, USD) */
  ratio: Decimal;
  /** additive offset for temperature: base = value*ratio + offset */
  offset?: Decimal;
  /** reciprocal unit (mpg vs L/100km): base = ratio / value */
  reciprocal?: boolean;
  /** display format: either a template with {} or a suffix, e.g. "m", "″", "${}" */
  format: string;
}

export interface Quantity {
  kind: "quantity";
  value: Decimal;
  unit: Unit | null;
  repr: NumeralRepr;
}

export interface PercentVal {
  kind: "percent";
  value: Decimal; // 20% -> 20
}

export interface DateVal {
  kind: "date";
  /** epoch ms */
  ms: number;
  hasTime: boolean;
  /** show only the time part ("time in Tokyo") */
  timeOnly?: boolean;
  /** IANA timezone for display, defaults to local */
  timeZone?: string;
}

export interface ChartValue {
  kind: "chart";
  points: Decimal[];
  unitLabel: string | null;
}

export type Value = Quantity | PercentVal | DateVal | ChartValue;

export function qty(value: Decimal.Value, unit: Unit | null = null, repr: NumeralRepr = "decimal"): Quantity {
  return { kind: "quantity", value: new Decimal(value), unit, repr };
}

export function pct(value: Decimal.Value): PercentVal {
  return { kind: "percent", value: new Decimal(value) };
}

export class EvalError extends Error {}

export interface EngineSettings {
  /** max decimal places shown */
  precision: number;
  /** thousands separator: "," | " " | "" */
  groupSeparator: string;
  /** decimal separator shown in output */
  decimalSeparator: string;
}

export const defaultSettings: EngineSettings = {
  precision: 2,
  groupSeparator: ",",
  decimalSeparator: ".",
};
