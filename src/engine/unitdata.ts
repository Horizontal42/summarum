// Conversion ratios. Base units per dimension: length=meter, area=m²,
// volume=m³, weight=gram, time=second, angle=radian, data=bit,
// temperature=kelvin (ratio+offset).
import { Decimal, Dimension } from "./types";

export interface UnitData {
  id: string;
  /** vocab category that holds `<id>.variants` / `<id>.format` */
  category: string;
  dimension: Dimension;
  ratio: string;
  offset?: string;
  /** which prefix family applies (si => mm/cm/km..., data => kilo..yotta + kibi..yobi) */
  prefixes?: "si" | "data";
  /** fallback format if vocab has none */
  format?: string;
}

const IN = 0.0254;

export const UNIT_DATA: UnitData[] = [
  // Length (base: meter)
  { id: "meter", category: "Length", dimension: "length", ratio: "1", prefixes: "si" },
  { id: "inch", category: "Length", dimension: "length", ratio: String(IN) },
  { id: "mile", category: "Length", dimension: "length", ratio: "1609.344" },
  { id: "foot", category: "Length", dimension: "length", ratio: "0.3048" },
  { id: "yard", category: "Length", dimension: "length", ratio: "0.9144" },
  { id: "point", category: "Length", dimension: "length", ratio: String(IN / 72) },
  { id: "cable", category: "Length", dimension: "length", ratio: "185.2" },
  { id: "league", category: "Length", dimension: "length", ratio: "4828.032" },
  { id: "furlong", category: "Length", dimension: "length", ratio: "201.168" },
  { id: "nautical_mile", category: "Length", dimension: "length", ratio: "1852" },
  { id: "chain", category: "Length", dimension: "length", ratio: "20.1168" },
  // CSS lengths (reference: 96px = 1in, 1em = 16px)
  { id: "pixel", category: "Css", dimension: "length", ratio: String(IN / 96) },
  { id: "em", category: "Css", dimension: "length", ratio: String(IN / 6) },

  // Area (base: m²)
  { id: "are", category: "Area", dimension: "area", ratio: "100" },
  { id: "hectare", category: "Area", dimension: "area", ratio: "10000" },
  { id: "acre", category: "Area", dimension: "area", ratio: "4046.8564224" },
  { id: "ping", category: "Area", dimension: "area", ratio: "3.30579" },

  // Volume (base: m³)
  { id: "litre", category: "Volume", dimension: "volume", ratio: "0.001", prefixes: "si" },
  { id: "cup", category: "Volume", dimension: "volume", ratio: "0.0002365882365" },
  { id: "tablespoon", category: "Volume", dimension: "volume", ratio: "0.0000147867647825" },
  { id: "teaspoon", category: "Volume", dimension: "volume", ratio: "0.00000492892159375" },
  { id: "quart", category: "Volume", dimension: "volume", ratio: "0.000946352946" },
  { id: "pint", category: "Volume", dimension: "volume", ratio: "0.000473176473" },
  { id: "gallon", category: "Volume", dimension: "volume", ratio: "0.003785411784" },
  { id: "cbinch", category: "Volume", dimension: "volume", ratio: "0.000016387064", format: "in³" },
  { id: "cbcm", category: "Volume", dimension: "volume", ratio: "0.000001", format: "cm³" },

  // Weight (base: gram)
  { id: "gram", category: "Weight", dimension: "weight", ratio: "1", prefixes: "si" },
  { id: "tonne", category: "Weight", dimension: "weight", ratio: "1000000" },
  { id: "stone", category: "Weight", dimension: "weight", ratio: "6350.29318" },
  { id: "carat", category: "Weight", dimension: "weight", ratio: "0.2" },
  { id: "pound", category: "Weight", dimension: "weight", ratio: "453.59237" },
  { id: "centner", category: "Weight", dimension: "weight", ratio: "100000" },
  { id: "ounce", category: "Weight", dimension: "weight", ratio: "28.349523125" },

  // Temperature (base: kelvin); base = value*ratio + offset
  { id: "celsius", category: "Temperature", dimension: "temperature", ratio: "1", offset: "273.15" },
  { id: "fahrenheit", category: "Temperature", dimension: "temperature", ratio: String(5 / 9), offset: String((459.67 * 5) / 9) },
  { id: "kelvin", category: "Temperature", dimension: "temperature", ratio: "1" },

  // Time (base: second). Month = 30 days, year = 365 days here;
  // date arithmetic uses real calendar months separately.
  { id: "second", category: "Time", dimension: "time", ratio: "1", prefixes: "si" },
  { id: "minute", category: "Time", dimension: "time", ratio: "60" },
  { id: "hour", category: "Time", dimension: "time", ratio: "3600" },
  { id: "day", category: "Time", dimension: "time", ratio: "86400" },
  { id: "week", category: "Time", dimension: "time", ratio: "604800" },
  { id: "month", category: "Time", dimension: "time", ratio: "2592000" },
  { id: "year", category: "Time", dimension: "time", ratio: "31536000" },

  // Angle (base: radian)
  { id: "radian", category: "Angle", dimension: "angle", ratio: "1" },
  { id: "degree", category: "Angle", dimension: "angle", ratio: String(Math.PI / 180) },

  // Data (base: bit)
  { id: "bit", category: "Data", dimension: "data", ratio: "1", prefixes: "data" },
  { id: "byte", category: "Data", dimension: "data", ratio: "8", prefixes: "data" },
];

export interface PrefixData {
  id: string; // vocab id in SIPrefixes/IECPrefixes
  category: "SIPrefixes" | "IECPrefixes";
  mult: string;
}

export const SI_PREFIXES: PrefixData[] = [
  { id: "yotta", category: "SIPrefixes", mult: "1e24" },
  { id: "zetta", category: "SIPrefixes", mult: "1e21" },
  { id: "exa", category: "SIPrefixes", mult: "1e18" },
  { id: "peta", category: "SIPrefixes", mult: "1e15" },
  { id: "tera", category: "SIPrefixes", mult: "1e12" },
  { id: "giga", category: "SIPrefixes", mult: "1e9" },
  { id: "mega", category: "SIPrefixes", mult: "1e6" },
  { id: "kilo", category: "SIPrefixes", mult: "1e3" },
  { id: "hecto", category: "SIPrefixes", mult: "1e2" },
  { id: "deca", category: "SIPrefixes", mult: "1e1" },
  { id: "deci", category: "SIPrefixes", mult: "1e-1" },
  { id: "centi", category: "SIPrefixes", mult: "1e-2" },
  { id: "milli", category: "SIPrefixes", mult: "1e-3" },
  { id: "micro", category: "SIPrefixes", mult: "1e-6" },
  { id: "nano", category: "SIPrefixes", mult: "1e-9" },
  { id: "pico", category: "SIPrefixes", mult: "1e-12" },
  { id: "femto", category: "SIPrefixes", mult: "1e-15" },
  { id: "atto", category: "SIPrefixes", mult: "1e-18" },
  { id: "zepto", category: "SIPrefixes", mult: "1e-21" },
  { id: "yocto", category: "SIPrefixes", mult: "1e-24" },
];

/** Prefixes ≥ kilo, applied to data units (no millibits). */
export const DATA_SI_PREFIXES = SI_PREFIXES.filter((p) => new Decimal(p.mult).gte(1000));

export const IEC_PREFIXES: PrefixData[] = [
  { id: "kibi", category: "IECPrefixes", mult: "1024" },
  { id: "mebi", category: "IECPrefixes", mult: String(2 ** 20) },
  { id: "gibi", category: "IECPrefixes", mult: String(2 ** 30) },
  { id: "tebi", category: "IECPrefixes", mult: String(2 ** 40) },
  { id: "pebi", category: "IECPrefixes", mult: new Decimal(2).pow(50).toString() },
  { id: "exbi", category: "IECPrefixes", mult: new Decimal(2).pow(60).toString() },
  { id: "zebi", category: "IECPrefixes", mult: new Decimal(2).pow(70).toString() },
  { id: "yobi", category: "IECPrefixes", mult: new Decimal(2).pow(80).toString() },
];

export const SCALE_DATA: Record<string, string> = {
  thousand: "1e3",
  million: "1e6",
  billion: "1e9",
};
