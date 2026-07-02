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
  updater.ts         checks tauri-plugin-updater, installs + relaunches
src-tauri/
  src/main.rs        tray, hide-to-tray, storage commands, rates fetching
                     (open.er-api.com + CoinGecko + Yahoo Finance) with
                     cache, historical rates (frankfurter.app, permanent
                     per-date cache), backups, data-folder migration,
                     file drops, plugin registration (autostart,
                     global-shortcut, single-instance, opener, dialog,
                     updater, process)
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
  The same `on` token doubles as the historical-rate date separator (`in EUR on
  2024-01-01`) — `parseSeq` checks for `pctop(on)` + `datelit` right after a
  currency conv target and consumes both when present.
- Currency rates are "units per USD"; a currency Unit's ratio is computed at
  evaluation time from the current rate map, so re-setting rates re-prices
  everything on the next evaluation. Historical rates live in a separate
  `historicalRates: Map<date, Map<code, number>>` on `SumEngine` and are
  passed through `EvalCtx` to `evalConv`.
- Live market data (stocks, commodities via Yahoo Finance) is merged into the
  same rate map as exchange rates via `applyAllRates()` in `main.ts` to avoid
  one `setRates()` call overwriting the other.
- Goal seek (`? * 1.2 = 1000`) tokenizes `?` as `{ t: "unknown" }`, parsed
  into `{ k: "unknown" }` nodes. `parseLine` detects the presence of `unknown`
  + `assign` and builds a `{ k: "goalseek", lhs, rhs }` node. The solver
  tries a linear probe (f(0), f(1) → exact root for affine expressions) and
  falls back to bisection for nonlinear ones.
- `ChartValue` (`kind: "chart"`) is returned by `evalAgg("chart", …)` and
  bypasses `formatValue` — the results overlay renders an SVG sparkline
  instead of a text string.
- The registry is rebuilt never; extensions mutate it (add phrases/functions)
  at startup.

## Cross-sheet references

`@Sheet.key` is lexed directly in `lexer.ts` (not through the phrase
registry — sheet titles are arbitrary user text, not vocabulary), producing
an `xref` lexeme carrying `{ sheet, key }`. The engine only knows how to
*ask* for a value: `EvalCtx.resolveXRef?.(sheet, key)` returns
`{ ok: true; value } | { ok: false; reason }`; when no resolver is supplied
(tests, extensions, `evaluateExpression`) an xref is simply unresolved.
Unresolved xrefs throw `XRefError` internally, caught in
`SumEngine.evaluateDocument` and surfaced as `LineResult.error` (rendered as
`#ref?` in the results column) — every other evaluation error still resolves
to a silent blank line, unchanged.

The engine has no concept of "other sheets" — that lives entirely in
`src/workspace.ts`. `Workspace` reads all sheet texts from the app's
in-memory `data.contents`, caches each sheet's exports (its assigned
variables, `total`, `last`) after first evaluating it, and invalidates a
sheet's cache plus every transitive dependent (found via a text scan for
`@Name.`) when it's edited or rates refresh. `Workspace.evaluateSheet(id,
text)` pushes `id` onto a resolving-stack for the duration of the call, so a
sheet that references itself — directly or through another sheet — hits an
already-on-the-stack check and resolves to `circular reference` instead of
recursing forever.

## UI notes

- CodeMirror injects its base theme at runtime *after* `app.css`, so anything
  that must win (content padding for the results column, cursor color) lives
  in an `EditorView.theme(...)` extension, not the stylesheet.
- The results column is an absolutely-positioned overlay; each result is
  placed with `view.lineBlockAt(...)` screen coordinates and re-rendered on
  scroll/geometry changes. Click-to-copy reads `data-value`.
- Engine evaluation is synchronous on every keystroke — a full sheet parse
  is well under a millisecond, so there's no debounce or worker.
- Search-all-sheets (`Ctrl+F`) is a plain line scan over `data.contents` in
  `main.ts`, not a CodeMirror search extension — it has to cross documents,
  so it never touches the active editor until a result is clicked
  (`editor.goToLine`).

## Storage

- `settings.json` always sits in `%APPDATA%/app.summarum.calc`.
- `documents.json` (all sheets) + `backups/` live either there or in the
  user-chosen data folder (the path is stored in settings).
- Daily snapshot at startup (`backups/documents-YYYY-MM-DD.json`, keep 14);
  deleted sheets become `.numi` files under `backups/deleted/` and are pruned
  by age. Saving is debounced at 400 ms.

## Auto-update

- `updater.ts` calls `tauri-plugin-updater`'s `check()` on boot; if a signed
  update is available the user is prompted, then `downloadAndInstall()` +
  `tauri-plugin-process`'s `relaunch()`.
- The update endpoint is `latest.json` published alongside each GitHub
  Release. `release.yml` signs both architectures with a minisign keypair:
  the public half is embedded in `tauri.conf.json`; the private half + its
  password live only as `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` repo secrets
  (write-only — there is no durable copy in the repo). Losing that key means
  already-installed copies can never trust a future signed release again.

## Storage (cache files)

All files below live in `%APPDATA%/app.summarum.calc` (or the user-chosen folder):

| File | Contents | TTL |
|------|----------|-----|
| `settings.json` | app settings | persisted |
| `documents.json` | all sheets | persisted (400 ms debounce) |
| `rates.json` | live exchange rates | 1 hour |
| `market.json` | stock/commodity prices | 15 minutes |
| `rates-YYYY-MM-DD.json` | historical ECB rates for one date | permanent |
| `backups/documents-YYYY-MM-DD.json` | daily snapshots | 14 days |
| `backups/deleted/*.numi` | soft-deleted sheets | configurable |

## Tests

`npm test` runs 113 vitest cases over the engine (`src/engine/*.test.ts`):
every expression class, both languages, deterministic injected rates,
goal seek, historical rates (injected), plus a regression suite covering
all known-fixed bugs. UI is exercised manually; the engine is where the
complexity lives.
