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
    search.ts        cross-sheet search overlay (text + result-value queries)
    export.ts        renders the sheet + results to a PNG (clipboard/file)
    app.css          themes (light/dark via CSS variables)
  main.ts            app bootstrap: documents, settings, status bar, dnd
  storage.ts         Tauri commands / localStorage fallback
  extensions.ts      runs user .js files in a QuickJS/WASM sandbox, bridged
                     to the engine's numi.* API
  i18n.ts            interface strings (en/ru)
  updater.ts         checks tauri-plugin-updater, installs + relaunches
src-tauri/
  src/main.rs        tray, hide-to-tray, storage commands, rates fetching
                     (open.er-api.com + CoinGecko + Yahoo Finance v8 chart)
                     with cache, historical rates (frankfurter.dev, permanent
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
  at startup. `buildRegistry()` (`registry.ts`) is a thin orchestrator over
  `registerCoreVocab` / `registerUnits` / `registerAreaVolume` /
  `registerCurrencies` / `registerExtraUnits` / `registerCrypto` /
  `registerCompletions` — **call order matters**, since `Registry.addPhrase`
  keeps the *first* registration of an identical phrase and drops later ones
  (core vocab must win over unit/currency phrases that happen to collide).
- Multiplying two same-dimension quantities (`2 kg * 500 g`) converts the
  right operand into the left operand's unit before multiplying, so the
  result keeps a sane unit (`1 kg`, not `1000` in a `kg` label). Cross-dimension
  multiplication (`$12 * 3`, `5 hours * 2`) is unaffected — the right side is
  treated as a plain scale factor there.
- A `//` only starts a comment at the start of a line or after whitespace
  (`findCommentStart` in `index.ts`), so a URL like `see https://example.com`
  isn't truncated at the double slash.
- **Date literals and formats.** Besides ISO (`2024-01-01`), the lexer accepts
  `D.M.YYYY` / `M/D/YYYY` (`31.12.2024`, `12/31/2024`) with the same separator
  on both sides and a 4-digit year. Day/month order is disambiguated per
  literal: a component `>12` fixes which side is the day; if both are `≤12`,
  the engine's `dateFormat` setting decides. All three literal forms reject
  out-of-range components via a round-trip check (`validDateMs` in `lexer.ts`
  — `new Date(y, mo-1, d)` silently *rolls over* invalid dates like
  `2026-13-45` instead of erroring, so the constructed date's year/month/day
  are compared back against the input). `SumEngine` resolves `dateFormat:
  "system"` to an actual day/month order once via `detectDateOrder()`
  (`datetime.ts`, probes `Intl.DateTimeFormat` on a `2000-12-31` fixture) and
  passes it into `tokenize()` → `lexLine()` on every call; `"dmy"`/`"mdy"`
  settings skip detection. Display works the same way in reverse: `formatter.ts`
  either uses the OS-locale `Intl` formatting (`"system"`) or builds a fixed
  `YYYY-MM-DD` / `DD.MM.YYYY` / `MM/DD/YYYY` string via
  `Intl.DateTimeFormat(...).formatToParts()` (needed to respect the value's
  own IANA timezone, which a hand-rolled `ms`-based formatter can't do).
  `Intl.DateTimeFormat` instances are cached by options key in `formatter.ts`
  (`dtf()`) since constructing one is comparatively expensive and every dated
  line rebuilds its format on every render.
- Timezone name parsing (`time in Europe/Berlin`) has two independent traps.
  First, `parseLine`'s noise-filter only keeps word tokens that immediately
  follow a `conv` token (`in`/`as`/...); any other token type resets that
  state — a bare `/` between two timezone words would normally drop the
  second word before the parser ever sees it, so the filter special-cases a
  `/` that appears while collecting post-conv words. Second, `parseTarget()`'s
  word-collecting loop mirrors that same allowance so it keeps consuming past
  the `/` instead of stopping at the first word. Both places need the
  exception — fixing only one still drops `Europe/Berlin` down to `Europe`.

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
- Search-all-sheets (`Ctrl+F`) is a plain line scan over every open sheet's
  text, not a CodeMirror search extension — it has to cross documents, so it
  never touches the active editor until a result is clicked
  (`editor.goToLine`). It lives in `src/ui/search.ts` (`initSearch()`), which
  owns the `#search-overlay` DOM and its own 150 ms input debounce — a
  result-value query (`>1000`) re-evaluates every open sheet, so debouncing
  matters once there are more than a couple of sheets open.
- The settings popover is split into four tabs (General / Format / Data /
  Updates) in `index.html`, each a `.settings-tabpanel` toggled by a
  `#settings-tabs .tab` button in `bindSettingsUI()` (`main.ts`) — plain
  `classList.toggle`, no router. Tab styling reuses the sidebar's
  `doc-item.active` idiom (`background: var(--sel)` for the active pill)
  rather than introducing a new visual pattern.

## Storage

- `settings.json` always sits in `%APPDATA%/app.summarum.calc`.
- `documents.json` (all sheets) + `backups/` live either there or in the
  user-chosen data folder (the path is stored in settings).
- Daily snapshot at startup (`backups/documents-YYYY-MM-DD.json`, keep 14);
  deleted sheets become `.numi` files under `backups/deleted/` and are pruned
  by age. Saving is debounced at 400 ms.

## Platforms and packaging

- One codebase, three desktop targets. `tauri.conf.json` holds everything
  shared; the per-platform bits live in `tauri.windows.conf.json`,
  `tauri.linux.conf.json` and `tauri.macos.conf.json`, which Tauri merges over
  the base config (JSON Merge Patch) according to the target being built. Each
  one only sets `bundle.targets` and that platform's bundler options — NSIS on
  Windows, deb/rpm/AppImage on Linux, .app/.dmg on macOS.
- `release.yml` builds five artifacts on three runner families: Windows x64 and
  arm64, Linux x64 (`ubuntu-22.04` — the oldest runner carrying webkit2gtk-4.1,
  which keeps the glibc floor low), macOS arm64 and x64. Two separate macOS
  targets rather than `universal-apple-darwin`: it matches how Windows already
  ships per-architecture, halves each download, and gives the updater the
  `darwin-aarch64`/`darwin-x86_64` keys it looks up by default.
- The whole matrix stays `max-parallel: 1`. Every job hands its assets to the
  *same* GitHub Release object, and tauri-action's find-or-create check races if
  two jobs reach it at once — adding platforms did not change that constraint,
  it made it apply to more jobs.
- No OS code signing anywhere. Windows ships unsigned; macOS is *ad-hoc* signed
  (`bundle.macOS.signingIdentity: "-"`), which needs no Apple certificate but is
  required for Apple Silicon to run a downloaded binary at all — without it the
  arm64 build is rejected as damaged rather than merely warned about. Gatekeeper
  still asks the user to allow the app on first launch either way.
- `bundle.fileAssociations` covers `.numi`/`.sum` on Windows (NSIS registry
  entries) and macOS (`CFBundleDocumentTypes`). On Linux it writes nothing
  useful: registering an extension there also needs a shared-mime-info XML that
  Tauri does not generate, so `.numi` files are opened by dragging them into the
  window rather than from the file manager.
- `icons/icon.icns` is emitted by `scripts/gen-icon.ts` alongside the PNGs and
  the `.ico`, hand-rolled the same dependency-free way: `icns` magic + total
  length, then one `[OSType][length][PNG]` chunk per size, using the modern
  PNG-payload tags `iconutil` produces (`icp4`/`icp5`, `ic07`–`ic14`). Rerun it
  with `npm run icons` after touching the artwork.

## Auto-update

- `updater.ts` calls `tauri-plugin-updater`'s `check()` on boot; if a signed
  update is available the user is prompted, then `downloadAndInstall()` +
  `tauri-plugin-process`'s `relaunch()`. `checkForUpdate()` returns
  `AvailableUpdate | null | "error"` — `null` means the check succeeded and
  found nothing newer, `"error"` means the check itself failed (offline,
  signature mismatch, etc.); the distinction only matters for the manual path
  below. Every outcome is now visible in devtools: failures via
  `console.warn`, and a successful "no update" result logs the running
  version alongside "that's the latest published release" via `console.info`
  — the most common false alarm is simply that the installed build already
  *is* the newest release (e.g. right after installing it), which used to be
  indistinguishable from a silently broken check.
- Closing the window hides it to the tray instead of exiting the process (see
  `on_window_event` in `main.rs`), so a boot-time-only check can go unnoticed
  for a long time on a machine that isn't restarted often. `main.ts` also
  reruns `checkUpdate()` on a `setInterval` (every 6 hours) so a long-lived
  tray process still notices new releases, and Settings → Updates has a
  manual "Check for updates" button (`checkUpdate(true)`) that reports
  "up to date" / "check failed" via toast — those toasts are suppressed on
  the automatic background checks so the app doesn't nag every few hours.
  A `SettingsData.autoUpdateEnabled` toggle turns off both the boot check and
  the periodic recheck (re-read from `settings` on every interval tick, so
  flipping it while the app is running takes effect immediately); the manual
  button ignores the toggle and always works.
- The update endpoint is `latest.json` published alongside each GitHub
  Release. `release.yml` signs every platform's updater artifact with a
  minisign keypair (this is Tauri's own update signing, unrelated to OS code
  signing):
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
| `rates.json` | live exchange rates (open.er-api.com + CoinGecko) | 1 hour |
| `market.json` | stock/commodity prices (Yahoo Finance v8 chart, one request per symbol) | 15 minutes |
| `rates-YYYY-MM-DD.json` | historical ECB rates for one date (frankfurter.dev) | permanent |
| `backups/documents-YYYY-MM-DD.json` | daily snapshots | 14 days |
| `backups/deleted/*.numi` | soft-deleted sheets | configurable |

## Tests

`npm test` runs 259 vitest cases: `src/engine/*.test.ts` covers every
expression class, both languages, deterministic injected rates, goal seek,
historical rates (injected), date-format literals/display (dedicated engines
with an explicit `dateFormat`, since the default "system" format depends on
the CI machine's locale), plus a regression suite covering all known-fixed
bugs; `src/workspace.test.ts` covers cross-sheet references, caching and
cycle detection. UI is exercised manually; the engine is where the complexity
lives.
