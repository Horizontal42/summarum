// Date helpers and a city → IANA timezone map for "time in Tokyo".

const Z: Record<string, string> = {
  // ---- common abbreviations
  utc: "UTC", gmt: "UTC", est: "America/New_York", edt: "America/New_York",
  cst: "America/Chicago", cdt: "America/Chicago", mst: "America/Denver",
  pst: "America/Los_Angeles", pdt: "America/Los_Angeles", msk: "Europe/Moscow",
  cet: "Europe/Paris", eet: "Europe/Kyiv", jst: "Asia/Tokyo", ist: "Asia/Kolkata",
  // ---- cities (en)
  "new york": "America/New_York", "los angeles": "America/Los_Angeles",
  "san francisco": "America/Los_Angeles", chicago: "America/Chicago",
  seattle: "America/Los_Angeles", boston: "America/New_York", miami: "America/New_York",
  toronto: "America/Toronto", vancouver: "America/Vancouver",
  "mexico city": "America/Mexico_City", "sao paulo": "America/Sao_Paulo",
  "buenos aires": "America/Argentina/Buenos_Aires", lima: "America/Lima",
  london: "Europe/London", dublin: "Europe/Dublin", lisbon: "Europe/Lisbon",
  madrid: "Europe/Madrid", barcelona: "Europe/Madrid", paris: "Europe/Paris",
  berlin: "Europe/Berlin", munich: "Europe/Berlin", amsterdam: "Europe/Amsterdam",
  brussels: "Europe/Brussels", zurich: "Europe/Zurich", geneva: "Europe/Zurich",
  rome: "Europe/Rome", milan: "Europe/Rome", vienna: "Europe/Vienna",
  prague: "Europe/Prague", warsaw: "Europe/Warsaw", stockholm: "Europe/Stockholm",
  oslo: "Europe/Oslo", copenhagen: "Europe/Copenhagen", helsinki: "Europe/Helsinki",
  athens: "Europe/Athens", istanbul: "Europe/Istanbul", kyiv: "Europe/Kyiv",
  kiev: "Europe/Kyiv", minsk: "Europe/Minsk", moscow: "Europe/Moscow",
  "saint petersburg": "Europe/Moscow", riga: "Europe/Riga", vilnius: "Europe/Vilnius",
  tallinn: "Europe/Tallinn", tbilisi: "Asia/Tbilisi", yerevan: "Asia/Yerevan",
  baku: "Asia/Baku", dubai: "Asia/Dubai", "abu dhabi": "Asia/Dubai",
  "tel aviv": "Asia/Jerusalem", jerusalem: "Asia/Jerusalem", riyadh: "Asia/Riyadh",
  doha: "Asia/Qatar", tehran: "Asia/Tehran", karachi: "Asia/Karachi",
  delhi: "Asia/Kolkata", mumbai: "Asia/Kolkata", bangalore: "Asia/Kolkata",
  kolkata: "Asia/Kolkata", dhaka: "Asia/Dhaka", bangkok: "Asia/Bangkok",
  hanoi: "Asia/Ho_Chi_Minh", "ho chi minh": "Asia/Ho_Chi_Minh",
  jakarta: "Asia/Jakarta", singapore: "Asia/Singapore", "kuala lumpur": "Asia/Kuala_Lumpur",
  manila: "Asia/Manila", "hong kong": "Asia/Hong_Kong", taipei: "Asia/Taipei",
  beijing: "Asia/Shanghai", shanghai: "Asia/Shanghai", shenzhen: "Asia/Shanghai",
  seoul: "Asia/Seoul", tokyo: "Asia/Tokyo", osaka: "Asia/Tokyo",
  sydney: "Australia/Sydney", melbourne: "Australia/Melbourne",
  brisbane: "Australia/Brisbane", perth: "Australia/Perth", auckland: "Pacific/Auckland",
  cairo: "Africa/Cairo", lagos: "Africa/Lagos", nairobi: "Africa/Nairobi",
  johannesburg: "Africa/Johannesburg", "cape town": "Africa/Johannesburg",
  casablanca: "Africa/Casablanca", almaty: "Asia/Almaty", astana: "Asia/Almaty",
  tashkent: "Asia/Tashkent", bishkek: "Asia/Bishkek", novosibirsk: "Asia/Novosibirsk",
  yekaterinburg: "Asia/Yekaterinburg", vladivostok: "Asia/Vladivostok",
  // ---- cities (ru)
  "нью йорк": "America/New_York", "лос анджелес": "America/Los_Angeles",
  "сан франциско": "America/Los_Angeles", чикаго: "America/Chicago",
  торонто: "America/Toronto", лондон: "Europe/London", париж: "Europe/Paris",
  берлин: "Europe/Berlin", мадрид: "Europe/Madrid", рим: "Europe/Rome",
  амстердам: "Europe/Amsterdam", вена: "Europe/Vienna", прага: "Europe/Prague",
  варшава: "Europe/Warsaw", стокгольм: "Europe/Stockholm", хельсинки: "Europe/Helsinki",
  афины: "Europe/Athens", стамбул: "Europe/Istanbul", киев: "Europe/Kyiv",
  минск: "Europe/Minsk", москва: "Europe/Moscow", москве: "Europe/Moscow",
  питер: "Europe/Moscow", "санкт петербург": "Europe/Moscow", петербург: "Europe/Moscow",
  рига: "Europe/Riga", вильнюс: "Europe/Vilnius", таллин: "Europe/Tallinn",
  тбилиси: "Asia/Tbilisi", ереван: "Asia/Yerevan", баку: "Asia/Baku",
  дубай: "Asia/Dubai", дубае: "Asia/Dubai", "тель авив": "Asia/Jerusalem",
  дели: "Asia/Kolkata", мумбаи: "Asia/Kolkata", бангкок: "Asia/Bangkok",
  бангкоке: "Asia/Bangkok", сингапур: "Asia/Singapore", сингапуре: "Asia/Singapore",
  джакарта: "Asia/Jakarta", гонконг: "Asia/Hong_Kong", пекин: "Asia/Shanghai",
  шанхай: "Asia/Shanghai", сеул: "Asia/Seoul", токио: "Asia/Tokyo",
  сидней: "Australia/Sydney", мельбурн: "Australia/Melbourne", окленд: "Pacific/Auckland",
  каир: "Africa/Cairo", алматы: "Asia/Almaty", астана: "Asia/Almaty",
  ташкент: "Asia/Tashkent", бишкек: "Asia/Bishkek", новосибирск: "Asia/Novosibirsk",
  екатеринбург: "Asia/Yekaterinburg", владивосток: "Asia/Vladivostok",
};

/** Resolve a sequence of words to an IANA timezone. Tries longest run first. */
export function resolveZone(words: string[]): string | null {
  const lower = words.map((w) => w.toLowerCase().replace(/[-.]/g, " ").trim());
  if (lower[0] === "local") return Intl.DateTimeFormat().resolvedOptions().timeZone;
  for (let len = Math.min(lower.length, 3); len >= 1; len--) {
    const key = lower.slice(0, len).join(" ");
    if (Z[key]) return Z[key];
  }
  // direct IANA id like Europe/Berlin typed by hand
  const joined = words.join("/");
  try {
    new Intl.DateTimeFormat("en", { timeZone: joined });
    return joined;
  } catch {
    return null;
  }
}

export function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Calendar-aware add: months/years via Date methods, the rest via ms. */
export function addToDate(ms: number, amount: number, unitId: string): number {
  const baseId = unitId.includes(":") ? unitId.split(":")[1] : unitId;
  const d = new Date(ms);
  if (baseId === "month" && Number.isInteger(amount)) {
    d.setMonth(d.getMonth() + amount);
    return d.getTime();
  }
  if (baseId === "year" && Number.isInteger(amount)) {
    d.setFullYear(d.getFullYear() + amount);
    return d.getTime();
  }
  return ms; // caller falls back to ms math for everything else
}

export function isCalendarUnit(unitId: string, amount: number): boolean {
  const baseId = unitId.includes(":") ? unitId.split(":")[1] : unitId;
  return (baseId === "month" || baseId === "year") && Number.isInteger(amount);
}
