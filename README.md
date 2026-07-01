# Summarum

[Русский](README.ru.md)

**A calculator that works like a notepad.** Type what you're thinking — every line
gets a live answer in the right column. No buttons, no formula syntax, just text.

```
# Trip to Lisbon
flights $420
hotel $95 * 4 nights
food 30€ a day * 4 days and museums 25€
total                          → $1,066.97

5 inches in cm                 → 12.7 cm
100 km/h in mph                → 62.14 mph
$2000 in rubles                → 144,060 ₽
20% off 1500                   → 1,200
today + 6 weeks                → 22 July 2026
1000 USD in EUR on 2024-01-01  → € 917.30
? * 1.2 = 1000                 → 833.33
AAPL in USD                    → $213.55
days until 2027-01-01          → 183 day
chart                          → ▂▄▇█▆
```

Works in **English and Russian** at the same time: `5 метров в см`, `20$ в евро`,
`сумма` — no language switching.

## Install

Grab the latest `Summarum_*_x64-setup.exe` (or `arm64-setup.exe` on Windows
on ARM) from [Releases](../../releases), run it, done. The whole app is
about 2 MB. It checks for updates on its own after that.

Requirements:

- **Windows 10 (1803+) or Windows 11**, 64-bit.
- **[WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)** —
  already part of Windows 11 and most updated Windows 10 systems; if it's
  missing, the installer downloads it automatically.
- Internet connection is only needed for live rates and market data — everything
  else works offline (rates fall back to a cached/bundled snapshot).

## What it understands

**Plain math** — `2 + 2`, `8 / (45 - 20%)`, parentheses, `^`, `sqrt`, `sin`,
factorials, `random()`, `random(1; 6)`. Decimal-exact: `0.1 + 0.2` is `0.3`,
not `0.30000000000000004`.

**Words as operators** — `12 plus 4`, `20 divided by 4`, `5 и 3`. Text around
the math is ignored, so `spent 20 on pizza and 5 on coffee` just gives 25.

**Units** — length, weight, volume, area, temperature, time, angles, data
(`1 GiB in MB`), CSS px/em, speed, pressure, energy, power, frequency, fuel:

```
6 feet in meters        1 atm in mmHg         8 л/100км in mpg
2 hours 30 min in min   150 hp in kW          32 px in em
```

**Money** — ~150 currencies and the top-20 crypto with live rates
(refreshed hourly, cached for offline). `$100 + 20%`, `5 eth in USD`,
`9800 рублей в долларах`.

**Live market data** — stock and commodity prices refreshed every 15 minutes:
`100 AAPL in USD`, `2 GC=F in USD` (gold futures), `MSFT + GOOGL`.

**Historical exchange rates** — `1000 USD in EUR on 2024-01-01` looks up the
ECB rate for that exact date (via frankfurter.app) and caches it permanently.

**Percents the human way** — `20% of 80`, `20% off 1500`, `5 as a % of 25`,
`20% of what is 30`.

**Dates and time** — `today + 2 weeks`, `tomorrow - today`, `time in New York`,
`now in unix`, `1750000000 as date`. ISO date literals: `2024-01-01 + 30 days`,
`days until 2027-01-01`, `days since 2020-03-15`.

**Goal seek** — put `?` where the unknown is and an `=` with the target:
`? * 1.2 = 1000` → `833.33`, `100 - ? = 30` → `70`. Works for any expression
solvable by linear probe or bisection.

**Programmer stuff** — `0xFF & 0x0F`, `1 << 4`, `255 in hex`, `in binary`,
plus `in fraction` (0.75 → 3/4) and `in roman` (2026 → MMXXVI).

**Sheets that calculate** — variables (`rent = $500`), running totals
(`sum`, `avg`, `prev`, `count`, `min`, `max`, `product`), `#` headers,
`//` comments. The status bar always shows the sheet total; select a few lines
to see just their sum. Add `chart` at the end of a block to draw a sparkline.

## Handy things

- **Ctrl+Alt+N** (configurable — the settings field records keys you press)
  shows/hides the window from anywhere. Closing hides to tray.
- **Ctrl+W** closes the current sheet (asks first if it has content).
- **Ctrl+F** (or the 🔍 button) searches every sheet at once — by text or by
  result value: `>1000`, `<50`, `=100`, `~100` (±1%). Click a hit to jump there.
- **Click a result** to copy it. Copying a line copies it *with* the answer
  (`rent * 3 = $1,500`). **Ctrl+Shift+C** copies the whole sheet with answers.
- **Export as image** — the ⤓ menu includes "Copy as image": renders the sheet
  to a PNG and puts it on the clipboard (falls back to file save if the browser
  blocks clipboard write).
- **Drag the divider** to resize the results column.
- **Drop a `.numi`, `.sum`, `.txt` or `.md` file** into the window to open it
  as a sheet.
- **Pin and reorder sheets** — click the pin icon on any sheet in the sidebar
  to keep it at the top; use ↑↓ to rearrange.
- **Backups are automatic**: a daily snapshot of all sheets (last 14 kept), and
  deleted sheets sit in a bin for 14 days (configurable) — restore one by
  dragging the file back in. Settings → Backups opens the folder.
- **Data folder is configurable** — point it at OneDrive/Dropbox and your
  sheets follow you between machines.
- **Always on top** (Settings) pins the window above everything else.
- The app checks for updates on launch and offers to install them — no
  manual download-and-reinstall.
- Light/dark theme, en/ru interface, configurable precision and separators.

## Extensions

> **Note:** extensions run as trusted local scripts with access to your files. Only load code you wrote or fully trust.

Drop a `.js` file into the extensions folder (Settings → Extensions folder)
and restart. The API is compatible with Numi extensions:

```js
numi.setVariable("vat", { double: 20 });
numi.addUnit({ id: "floor", phrases: "floor,floors", baseUnitId: "meter",
               format: "fl", ratio: 3 });
numi.addFunction({ id: "hyp", phrases: "hyp" },
  (v) => ({ double: Math.hypot(v[0].double, v[1].double) }));
```

Then `5 floors in meters` → `15 m` and `hyp(3; 4)` → `5`.

## Bugs and ideas

Open an [issue](../../issues). A line of text and what you expected is enough.

## For developers

Engine internals, project layout and how to add units/currencies:
see [ARCHITECTURE.md](ARCHITECTURE.md).

```bash
npm install
npm test               # engine tests (113 cases)
npm run tauri dev      # run the app
npm run tauri build    # build the installer
```

To build from source you need:

- [Node.js](https://nodejs.org/) 22.6 or newer (`npm run icons` relies on
  Node's built-in TypeScript support)
- [Rust](https://rustup.rs/) (stable, MSVC toolchain)
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
  with the "Desktop development with C++" workload (the MSVC linker)
- See the [Tauri prerequisites](https://tauri.app/start/prerequisites/) page
  if anything refuses to compile

Stack: [Tauri 2](https://tauri.app) + TypeScript + CodeMirror 6.

## Credits

Inspired by the excellent [Numi](https://numi.app) by Dmitry Nikolaev —
if you're on macOS, buy it. Summarum is an independent project, built from
scratch for Windows.

## License

[PolyForm Noncommercial 1.0.0](LICENSE) — free for personal, educational, and other noncommercial use. Commercial use (including resale or repackaging) is not permitted.
