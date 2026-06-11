# Architecture

For people who want to read or change the code. The app is two parts:
a **TypeScript calculation engine + UI** running in WebView2, and a thin
**Rust shell** (Tauri 2) for everything OS-specific.

```
src/
  engine/          the calculator itself (pure TS, no DOM)
    lexer.ts         line → raw lexemes (numbers, words, symbols)
    vocab-data.ts    en+ru word tables: unit names, currencies, operators
    vocab.ts         merged lookup over the tables
    unitdata.ts      conversion ratios (base units per dimension)
    extraunits.ts    speed/pressure/energy/power/frequency/fuel + crypto list
    registry.ts      phrase → token payload; built once at startup
    tokenizer.ts     lexemes + registry → semantic tokens
    parser.ts        tokens → AST (noise-tolerant Pratt parser)
    evaluator.ts     AST + document context → values with units
    formatter.ts     values → display strings
    datetime.ts      timezone map, calendar arithmetic
    index.ts         SumEngine facade + extension API + sheet totals
  ui/
    editor.ts        CodeMirror 6 wiring: highlight, results overlay, copy
    app.css          themes (light/dark via CSS variables)
  main.ts            app bootstrap: documents, settings, status bar, dnd
  storage.ts         Tauri commands / localStorage fallback
  extensions.ts      runs user .js files against the engine
  i18n.ts            interface strings (en/ru)
src-tauri/
  src/main.rs        tray, hide-to-tray, storage commands, rates fetching
                     (open.er-api.com + CoinGecko) with cache, backups,
                     data-folder migration, file drops
```

## How a line becomes a result

1. **Lexer** splits `"5 inches in cm"` into lexemes: `5`, `inches`, `in`, `cm`.
   The same lexer segments vocabulary phrases, so matching is consistent.
2. **Registry** holds every phrase the engine knows, keyed by first lexeme.
   Longest match wins; case-sensitive entries (`m` vs `M`, `kB`) are tried
   before case-insensitive ones, and an ambiguous lowercase form (`mm` vs `Mm`)
   simply doesn't get a case-insensitive fallback.
3. **Tokenizer** walks the lexemes, asks the registry, and emits typed tokens.
   A couple of context hacks live here, e.g. `in` right after a number at the
   end of a line means inches (`6 ft 3 in`).
4. **Parser** is a Pratt parser that tolerates noise: unknown words are
   dropped before parsing (that's why `spent 20 on pizza plus 5` works) —
   except words right after a conversion operator, which may name a timezone.
   Precedence, loosest to tightest: line-level conversions (`in cm` applies to
   the merged line, so `2 hours 30 minutes in minutes` works) → bitwise →
   additive → multiplicative (incl. `20% of x`) → unary → postfix
   (units, `%`, `!`, `^`) → primary.
5. **Evaluator** computes `{ value: Decimal, unit }` triples. Same-dimension
   operands convert through base units (`toBase`/`fromBase`); temperatures
   carry an offset, fuel economy units can be reciprocal (mpg ↔ L/100km).
   The document context supplies variables and previous line results for
   `sum`/`avg`/`prev`.
6. **Formatter** renders the value with the unit's display format, precision
   and grouping from settings, or as hex/binary/fraction/roman/etc.

Numbers are `decimal.js` throughout — no binary float artifacts.

## Adding things

**A unit** — add a row to `UNIT_DATA` in `unitdata.ts` (id, dimension, ratio
to the dimension base) and its names to `vocab-data.ts` under the matching
category (`"myunit.variants": "name,names,имя"`, `"myunit.format": "sym"`).
For a brand-new dimension, extend the `Dimension` union in `types.ts` and use
`extraunits.ts` — phrases live inline there.

**A currency** — fiat codes come from the `Currency` table in `vocab-data.ts`;
crypto goes in `CRYPTO` in `extraunits.ts` (code, CoinGecko id, phrases,
snapshot price) plus the mirror list in `src-tauri/src/main.rs`.

**An operator/function** — register the phrase in `buildRegistry()`
(`registry.ts`), add a token/AST case if it needs new syntax, implement in
`evaluator.ts`. Most word-operators are data, not code.

**A timezone city** — one line in the `Z` map in `datetime.ts`.

## Engine gotchas

- Phrase conflicts are real: single letters are case-sensitive by design
  (`m` meter / `M` million, `k` thousand / `K` kelvin). Prefix generation is
  filtered where it collides with words — e.g. seconds only get ms/µs/ns/ps
  because an "attosecond" symbol would shadow the word `as`.
- `and`/`or` are dual-purpose: `and` adds (`5 and 3` = 8), `or` is bitwise.
  `of/off/on` only act on a percent left-hand side; otherwise they're prose.
- Currency rates are "units per USD"; a currency Unit's ratio is computed at
  tokenization time from the current rate map, so re-setting rates re-prices
  everything on the next evaluation.
- The registry is rebuilt never; extensions mutate it (add phrases/functions)
  at startup.

## UI notes

- CodeMirror injects its base theme at runtime *after* `app.css`, so anything
  that must win (content padding for the results column, cursor color) lives
  in an `EditorView.theme(...)` extension, not the stylesheet.
- The results column is an absolutely-positioned overlay; each result is
  placed with `view.lineBlockAt(...)` screen coordinates and re-rendered on
  scroll/geometry changes. Click-to-copy reads `data-value`.
- Engine evaluation is synchronous on every keystroke — a full sheet parse
  is well under a millisecond, so there's no debounce or worker.

## Storage

- `settings.json` always sits in `%APPDATA%/app.summarum.calc`.
- `documents.json` (all sheets) + `backups/` live either there or in the
  user-chosen data folder (the path is stored in settings).
- Daily snapshot at startup (`backups/documents-YYYY-MM-DD.json`, keep 14);
  deleted sheets become `.numi` files under `backups/deleted/` and are pruned
  by age. Saving is debounced at 400 ms.

## Tests

`npm test` runs ~94 vitest cases over the engine (`src/engine/*.test.ts`):
every expression class, both languages, deterministic injected rates,
plus a regression suite covering all known-fixed bugs.
UI is exercised manually; the engine is where the complexity lives.
