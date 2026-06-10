// Speed, pressure, energy, power, frequency and fuel consumption units,
// plus cryptocurrencies. Phrases inline (en + ru).

export interface ExtraUnitDef {
  id: string;
  dimension: "speed" | "pressure" | "energy" | "power" | "frequency" | "fuel";
  /** multiplier to the dimension base: m/s, Pa, J, W, Hz, L/100km */
  ratio: string;
  /** reciprocal unit: base = ratio / value (mpg) */
  reciprocal?: boolean;
  format: string;
  /** comma-separated, matched case-insensitively */
  phrases: string;
  /** matched case-sensitively (symbols like kW vs KW ambiguity) */
  symbols?: string;
}

export const EXTRA_UNITS: ExtraUnitDef[] = [
  // ---- speed (base: m/s)
  { id: "mps", dimension: "speed", ratio: "1", format: "m/s", phrases: "m/s,meter per second,meters per second,м/с,метров в секунду" },
  { id: "kmh", dimension: "speed", ratio: String(1 / 3.6), format: "km/h", phrases: "km/h,kmh,kph,kilometers per hour,kilometres per hour,км/ч,кмч,километров в час" },
  { id: "mph", dimension: "speed", ratio: "0.44704", format: "mph", phrases: "mph,miles per hour,миль в час" },
  { id: "knot", dimension: "speed", ratio: "0.514444444", format: "kn", phrases: "knot,knots,kn,узел,узла,узлов" },
  { id: "fps", dimension: "speed", ratio: "0.3048", format: "ft/s", phrases: "ft/s,feet per second,фут/с" },

  // ---- pressure (base: Pa)
  { id: "pascal", dimension: "pressure", ratio: "1", format: "Pa", phrases: "pascal,pascals,паскаль,паскалей", symbols: "Pa" },
  { id: "kpa", dimension: "pressure", ratio: "1000", format: "kPa", phrases: "kilopascal,kilopascals,килопаскаль", symbols: "kPa" },
  { id: "mpa", dimension: "pressure", ratio: "1e6", format: "MPa", phrases: "megapascal,megapascals,мегапаскаль", symbols: "MPa" },
  { id: "hpa", dimension: "pressure", ratio: "100", format: "hPa", phrases: "hectopascal,hectopascals,гектопаскаль", symbols: "hPa" },
  { id: "bar", dimension: "pressure", ratio: "1e5", format: "bar", phrases: "bar,bars,бар,бара,баров" },
  { id: "mbar", dimension: "pressure", ratio: "100", format: "mbar", phrases: "mbar,millibar,millibars,миллибар" },
  { id: "atm", dimension: "pressure", ratio: "101325", format: "atm", phrases: "atm,atmosphere,atmospheres,атмосфер,атмосфера,атмосферы" },
  { id: "psi", dimension: "pressure", ratio: "6894.757293168", format: "psi", phrases: "psi" },
  { id: "mmhg", dimension: "pressure", ratio: "133.322387415", format: "mmHg", phrases: "mmhg,mm hg,torr,мм рт ст,мм рт. ст.,миллиметров ртутного столба", symbols: "mmHg" },

  // ---- energy (base: J)
  { id: "joule", dimension: "energy", ratio: "1", format: "J", phrases: "joule,joules,джоуль,джоулей,джоуля", symbols: "J" },
  { id: "kj", dimension: "energy", ratio: "1000", format: "kJ", phrases: "kilojoule,kilojoules,килоджоуль,килоджоулей", symbols: "kJ" },
  { id: "mj", dimension: "energy", ratio: "1e6", format: "MJ", phrases: "megajoule,megajoules,мегаджоуль", symbols: "MJ" },
  { id: "cal", dimension: "energy", ratio: "4.184", format: "cal", phrases: "calorie,calories,калория,калорий,калории,cal" },
  { id: "kcal", dimension: "energy", ratio: "4184", format: "kcal", phrases: "kcal,kilocalorie,kilocalories,ккал,килокалорий,килокалория" },
  { id: "wh", dimension: "energy", ratio: "3600", format: "Wh", phrases: "watt hour,watt hours,ватт-час,ватт-часов", symbols: "Wh" },
  { id: "kwh", dimension: "energy", ratio: "3.6e6", format: "kWh", phrases: "kwh,kilowatt hour,kilowatt hours,киловатт-час,киловатт-часов,квтч,квт-ч", symbols: "kWh" },
  { id: "mwh", dimension: "energy", ratio: "3.6e9", format: "MWh", phrases: "megawatt hour,megawatt hours,мегаватт-час", symbols: "MWh" },

  // ---- power (base: W)
  { id: "watt", dimension: "power", ratio: "1", format: "W", phrases: "watt,watts,ватт,ваттов", symbols: "W" },
  { id: "kw", dimension: "power", ratio: "1000", format: "kW", phrases: "kilowatt,kilowatts,киловатт,киловатта,квт", symbols: "kW" },
  { id: "mw", dimension: "power", ratio: "1e6", format: "MW", phrases: "megawatt,megawatts,мегаватт", symbols: "MW" },
  { id: "gw", dimension: "power", ratio: "1e9", format: "GW", phrases: "gigawatt,gigawatts,гигаватт", symbols: "GW" },
  { id: "hp", dimension: "power", ratio: "745.69987158", format: "hp", phrases: "hp,horsepower,horse power" },
  { id: "hp_metric", dimension: "power", ratio: "735.49875", format: "л.с.", phrases: "л.с.,лс,лошадиных сил,лошадиная сила,лошадиные силы,metric horsepower" },

  // ---- frequency (base: Hz)
  { id: "hz", dimension: "frequency", ratio: "1", format: "Hz", phrases: "hertz,герц,герца", symbols: "Hz" },
  { id: "khz", dimension: "frequency", ratio: "1e3", format: "kHz", phrases: "kilohertz,килогерц", symbols: "kHz" },
  { id: "mhz", dimension: "frequency", ratio: "1e6", format: "MHz", phrases: "megahertz,мегагерц", symbols: "MHz" },
  { id: "ghz", dimension: "frequency", ratio: "1e9", format: "GHz", phrases: "gigahertz,гигагерц", symbols: "GHz" },
  { id: "rpm", dimension: "frequency", ratio: String(1 / 60), format: "rpm", phrases: "rpm,revolutions per minute,оборотов в минуту,об/мин" },

  // ---- fuel consumption (base: L/100km; mpg is reciprocal)
  { id: "l100km", dimension: "fuel", ratio: "1", format: "L/100km", phrases: "l/100km,l/100 km,liters per 100 km,litres per 100 km,л/100км,л/100 км,литров на 100 км,литров на сотню" },
  { id: "mpg", dimension: "fuel", ratio: "235.214583", reciprocal: true, format: "mpg", phrases: "mpg,miles per gallon,миль на галлон" },
  { id: "mpg_imp", dimension: "fuel", ratio: "282.480936", reciprocal: true, format: "mpg (imp)", phrases: "imperial mpg,mpg imperial,uk mpg" },
];

/** Cryptocurrencies beyond BTC. code -> CoinGecko id + phrases + USD snapshot price. */
export interface CryptoDef {
  code: string;
  geckoId: string;
  phrases: string;
  /** approximate USD price for the offline snapshot */
  snapshotUsd: number;
}

export const CRYPTO: CryptoDef[] = [
  { code: "ETH", geckoId: "ethereum", phrases: "ethereum,ether,eth,эфир,эфириум", snapshotUsd: 2600 },
  { code: "SOL", geckoId: "solana", phrases: "solana,солана", snapshotUsd: 160 },
  { code: "BNB", geckoId: "binancecoin", phrases: "bnb,binance coin", snapshotUsd: 640 },
  { code: "XRP", geckoId: "ripple", phrases: "xrp,ripple,рипл", snapshotUsd: 2.2 },
  { code: "ADA", geckoId: "cardano", phrases: "cardano,ada,кардано", snapshotUsd: 0.7 },
  { code: "DOGE", geckoId: "dogecoin", phrases: "dogecoin,doge,доджкоин,дож", snapshotUsd: 0.18 },
  { code: "TRX", geckoId: "tron", phrases: "tron,trx,трон", snapshotUsd: 0.27 },
  { code: "TON", geckoId: "the-open-network", phrases: "toncoin,тонкоин", snapshotUsd: 3.5 },
  { code: "DOT", geckoId: "polkadot", phrases: "polkadot,полкадот", snapshotUsd: 4.5 },
  { code: "LTC", geckoId: "litecoin", phrases: "litecoin,ltc,лайткоин", snapshotUsd: 90 },
  { code: "AVAX", geckoId: "avalanche-2", phrases: "avalanche,avax", snapshotUsd: 25 },
  { code: "LINK", geckoId: "chainlink", phrases: "chainlink,чейнлинк", snapshotUsd: 15 },
  { code: "UNI", geckoId: "uniswap", phrases: "uniswap,юнисвап", snapshotUsd: 8 },
  { code: "XLM", geckoId: "stellar", phrases: "stellar,xlm,стеллар", snapshotUsd: 0.3 },
  { code: "XMR", geckoId: "monero", phrases: "monero,xmr,монеро", snapshotUsd: 170 },
  { code: "ATOM", geckoId: "cosmos", phrases: "cosmos,космос", snapshotUsd: 5 },
  { code: "BCH", geckoId: "bitcoin-cash", phrases: "bitcoin cash,bch", snapshotUsd: 450 },
  { code: "NEAR", geckoId: "near", phrases: "near protocol", snapshotUsd: 3 },
  { code: "USDT", geckoId: "tether", phrases: "tether,usdt,юсдт", snapshotUsd: 1 },
  { code: "USDC", geckoId: "usd-coin", phrases: "usdc", snapshotUsd: 1 },
];
