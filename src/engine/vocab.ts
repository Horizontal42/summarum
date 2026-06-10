// Merged phrase lists over the en + ru vocabulary tables.
// Shape: { Category: { "key.variants": "a,b,c", "key.format": "...", ... } }
import { EN, RU } from "./vocab-data";

export type VocabCategory = Record<string, string>;
export type VocabLocale = Record<string, VocabCategory>;

const locales: VocabLocale[] = [EN, RU];

/** All values for `category.key` across locales, comma-split, trimmed, deduped. */
export function variants(category: string, key: string): string[] {
  const out: string[] = [];
  for (const loc of locales) {
    const raw = loc[category]?.[key];
    if (!raw) continue;
    for (const v of raw.split(",")) {
      const t = v.trim();
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

/** Single value (first locale that has it), e.g. formats. */
export function entry(category: string, key: string): string | undefined {
  for (const loc of locales) {
    const raw = loc[category]?.[key];
    if (raw !== undefined) return raw;
  }
  return undefined;
}

/** English-only entry (formats should not be localized). */
export function entryEn(category: string, key: string): string | undefined {
  return EN[category]?.[key];
}

/** The entry value from every locale that defines it (e.g. unit symbols "m" and "м"). */
export function entriesAll(category: string, key: string): string[] {
  const out: string[] = [];
  for (const loc of locales) {
    const raw = loc[category]?.[key];
    if (raw && !out.includes(raw)) out.push(raw);
  }
  return out;
}

/** All base keys in a category that end with `.variants` (e.g. unit ids). */
export function idsOf(category: string): string[] {
  const ids = new Set<string>();
  for (const loc of locales) {
    const cat = loc[category];
    if (!cat) continue;
    for (const k of Object.keys(cat)) {
      if (k.endsWith(".variants")) ids.add(k.slice(0, -".variants".length));
    }
  }
  return [...ids];
}

/** All keys of a category ending with a suffix, e.g. `.prefix` for SI prefixes. */
export function idsWithSuffix(category: string, suffix: string): string[] {
  const ids = new Set<string>();
  for (const loc of locales) {
    const cat = loc[category];
    if (!cat) continue;
    for (const k of Object.keys(cat)) {
      if (k.endsWith(suffix)) ids.add(k.slice(0, -suffix.length));
    }
  }
  return [...ids];
}
