/** App bootstrap: engine + editor + documents + settings + Tauri glue. */
import "./ui/app.css";
import { SumEngine } from "./engine";
import { SumEditor } from "./ui/editor";
import {
  AppData, DocMeta, SettingsData, defaultSettingsData,
  loadAppData, saveAppData, flushAppData, onAppQuit, loadSettings, saveSettings,
  fetchRates, fetchMarketData, fetchHistoricalRates, writeImageFile, loadExtensionScripts, openExtensionsFolder, isTauri,
  getLaunchFile, onOpenFile, onFileDrop,
  setDataDir, runBackups, backupDeletedSheet, openBackupsFolder,
  chooseFolder, dataDirHasDocuments, migrateDataDir,
} from "./storage";
import type { LineResult } from "./engine";
import { setLang, detectLang, t } from "./i18n";
import { runExtensions } from "./extensions";
import { checkForUpdate } from "./updater";
import { Workspace } from "./workspace";
import { EN, RU } from "./engine/vocab-data";

function welcomeText(lang: string): string {
  const sample = (lang === "ru" ? RU : EN).Samples?.["sample.welcome"];
  return (sample ?? "# Sample\n8 / (45 - 20%)\n5 inches in cm\n$9 in Euro") + "\n";
}

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

let engine: SumEngine;
let editor: SumEditor;
let workspace: Workspace;
let settings: SettingsData;
let data: AppData;
let lastResults: LineResult[] = [];
let selectedRange: [number, number] | null = null;
let ratesFetchedAt = 0;
let liveRates: Record<string, number> = {};

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ---------- documents

function activeDoc(): DocMeta {
  return data.docs.find((d) => d.id === data.activeId) ?? data.docs[0];
}

function titleFromContent(text: string): string {
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (s.length > 0) return s.replace(/^#\s*/, "").slice(0, 30);
  }
  return t("untitled");
}

function syncTitleField(): void {
  const field = $<HTMLInputElement>("#doc-title");
  if (document.activeElement !== field) field.value = activeDoc()?.title ?? "";
}

function pinDoc(id: string): void {
  const doc = data.docs.find((d) => d.id === id);
  if (!doc) return;
  doc.pinned = !doc.pinned;
  if (doc.pinned) {
    // move to end of pinned group
    data.docs = data.docs.filter((d) => d.id !== id);
    let lastPinned = -1;
    for (let i = data.docs.length - 1; i >= 0; i--) { if (data.docs[i].pinned) { lastPinned = i; break; } }
    data.docs.splice(lastPinned + 1, 0, doc);
  } else {
    // move to start of non-pinned group
    data.docs = data.docs.filter((d) => d.id !== id);
    const firstNonPinned = data.docs.findIndex((d) => !d.pinned);
    data.docs.splice(firstNonPinned === -1 ? data.docs.length : firstNonPinned, 0, doc);
  }
  saveAppData(data);
  renderDocList();
}

function moveDoc(id: string, dir: -1 | 1): void {
  const idx = data.docs.findIndex((d) => d.id === id);
  if (idx < 0) return;
  const doc = data.docs[idx];
  const target = data.docs[idx + dir];
  if (!target || !!target.pinned !== !!doc.pinned) return; // can't cross pin boundary
  data.docs.splice(idx, 1);
  data.docs.splice(idx + dir, 0, doc);
  saveAppData(data);
  renderDocList();
}

function renderDocList(): void {
  const list = $("#doc-list");
  list.replaceChildren();
  for (const doc of data.docs) {
    const el = document.createElement("div");
    el.className = "doc-item" + (doc.id === data.activeId ? " active" : "") + (doc.pinned ? " pinned" : "");
    const name = document.createElement("span");
    name.className = "doc-name";
    name.textContent = doc.title || t("untitled");
    el.appendChild(name);

    const mkBtn = (cls: string, text: string, title: string, cb: () => void): HTMLButtonElement => {
      const b = document.createElement("button");
      b.className = cls;
      b.textContent = text;
      b.title = title;
      b.addEventListener("click", (e) => { e.stopPropagation(); cb(); });
      return b;
    };

    el.appendChild(mkBtn("pin-btn" + (doc.pinned ? " active" : ""), "📌", doc.pinned ? t("unpin") : t("pin"), () => pinDoc(doc.id)));
    el.appendChild(mkBtn("move-btn", "↑", t("moveUp"), () => moveDoc(doc.id, -1)));
    el.appendChild(mkBtn("move-btn", "↓", t("moveDown"), () => moveDoc(doc.id, 1)));

    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "✕";
    let confirmTimer: ReturnType<typeof setTimeout> | null = null;
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      if (data.docs.length === 1) return;
      if (!del.classList.contains("confirm")) {
        del.classList.add("confirm");
        del.textContent = "✓";
        confirmTimer = setTimeout(() => {
          del.classList.remove("confirm");
          del.textContent = "✕";
        }, 2000);
        return;
      }
      if (confirmTimer) clearTimeout(confirmTimer);
      void backupDeletedSheet(settings.dataDir, doc.title, data.contents[doc.id] ?? "");
      delete data.contents[doc.id];
      data.docs = data.docs.filter((d) => d.id !== doc.id);
      if (data.activeId === doc.id) switchDoc(data.docs[0].id);
      else renderDocList();
      saveAppData(data);
    });
    el.appendChild(del);
    el.addEventListener("click", () => switchDoc(doc.id));
    list.appendChild(el);
  }
}

function switchDoc(id: string): void {
  data.activeId = id;
  const text = data.contents[id] ?? "";
  editor.setText(text);
  syncTitleField();
  renderDocList();
  saveAppData(data);
  editor.focus();
  void fetchNeededHistoricalRates(text);
}

function newDoc(content = ""): void {
  const id = uid();
  data.docs.push({ id, title: content ? titleFromContent(content) : t("untitled") });
  data.contents[id] = content;
  switchDoc(id);
}

async function closeActiveDoc(): Promise<void> {
  if (data.docs.length <= 1) return;
  const doc = data.docs.find((d) => d.id === data.activeId);
  if (!doc) return;
  const content = data.contents[doc.id] ?? "";
  if (content.trim()) {
    const ans = await askModal(t("closeSheet"), t("close"), t("cancel"));
    if (ans !== "a") return;
  }
  const idx = data.docs.findIndex((d) => d.id === doc.id);
  void backupDeletedSheet(settings.dataDir, doc.title, content);
  delete data.contents[doc.id];
  data.docs = data.docs.filter((d) => d.id !== doc.id);
  const nextId = data.docs[idx] ? data.docs[idx].id : data.docs[idx - 1]?.id ?? data.docs[0].id;
  switchDoc(nextId);
  saveAppData(data);
}

// ---------- search all sheets

interface SearchHit {
  docId: string;
  docTitle: string;
  line: number;
  text: string;
  result?: string;
}

function parseResultQuery(q: string): { op: string; threshold: import("./engine").Value } | null {
  const m = /^(>=|<=|>|<|=|~)\s*(.+)$/.exec(q.trim());
  if (!m) return null;
  const v = engine.evaluateExpression(m[2].trim());
  if (!v || v.kind !== "quantity") return null;
  return { op: m[1], threshold: v };
}

function searchAllSheets(query: string): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const rq = parseResultQuery(q);
  if (rq && rq.threshold.kind === "quantity") {
    const th = rq.threshold.value;
    const hits: SearchHit[] = [];
    for (const doc of data.docs) {
      const contents = data.contents[doc.id] ?? "";
      const results = workspace.evaluateSheet(doc.id, contents);
      const lines = contents.split("\n");
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (!r.value || r.value.kind !== "quantity") continue;
        const v = r.value.value;
        let match = false;
        switch (rq.op) {
          case ">":  match = v.gt(th); break;
          case ">=": match = v.gte(th); break;
          case "<":  match = v.lt(th); break;
          case "<=": match = v.lte(th); break;
          case "=":  match = v.eq(th); break;
          case "~":  match = !th.isZero() && v.minus(th).abs().div(th.abs()).lte(0.01); break;
        }
        if (match) {
          hits.push({ docId: doc.id, docTitle: doc.title, line: i + 1, text: lines[i] ?? "", result: r.text ?? undefined });
          if (hits.length >= 200) return hits;
        }
      }
    }
    return hits;
  }
  const ql = q.toLowerCase();
  const hits: SearchHit[] = [];
  for (const doc of data.docs) {
    const lines = (data.contents[doc.id] ?? "").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(ql)) {
        hits.push({ docId: doc.id, docTitle: doc.title, line: i + 1, text: lines[i] });
        if (hits.length >= 200) return hits;
      }
    }
  }
  return hits;
}

function renderSearchResults(query: string, hits: SearchHit[]): void {
  const el = $("#search-results");
  el.replaceChildren();
  if (query.trim() && hits.length === 0) {
    const empty = document.createElement("div");
    empty.className = "search-empty";
    empty.textContent = t("searchEmpty");
    el.appendChild(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const hit of hits) {
    const item = document.createElement("div");
    item.className = "search-item";
    const docEl = document.createElement("div");
    docEl.className = "doc";
    docEl.textContent = hit.docTitle;
    const lineEl = document.createElement("div");
    lineEl.className = "line";
    lineEl.textContent = hit.result ? `${hit.text} = ${hit.result}` : hit.text;
    item.append(docEl, lineEl);
    item.addEventListener("click", () => {
      if (hit.docId !== data.activeId) switchDoc(hit.docId);
      editor.goToLine(hit.line);
      closeSearch();
    });
    frag.appendChild(item);
  }
  el.appendChild(frag);
}

function openSearch(): void {
  const input = $<HTMLInputElement>("#search-input");
  $("#search-overlay").classList.remove("hidden");
  input.value = "";
  renderSearchResults("", []);
  input.focus();
}

function closeSearch(): void {
  $("#search-overlay").classList.add("hidden");
}

// ---------- settings

function applySettings(): void {
  const theme = settings.theme === "system"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : settings.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty("--editor-font-size", `${settings.fontSize}px`);
  $("#editor-wrap").style.setProperty("--results-width", `${settings.resultsWidth}%`);
  setLang(settings.language);
  $<HTMLInputElement>("#search-input").placeholder = t("searchPlaceholder");
  engine.updateSettings({
    precision: settings.precision,
    groupSeparator: settings.groupSeparator,
    decimalSeparator: settings.decimalSeparator,
  });
  editor?.refresh();
  syncTitleField();
  $<HTMLElement>("#sidebar").classList.toggle("hidden", !settings.sidebarVisible);
}

function bindSettingsUI(): void {
  const themeSel = $<HTMLSelectElement>("#set-theme");
  const precision = $<HTMLInputElement>("#set-precision");
  const groupSep = $<HTMLSelectElement>("#set-groupsep");
  const decimalSep = $<HTMLSelectElement>("#set-decimalsep");
  const langSel = $<HTMLSelectElement>("#set-lang");
  const hotkey = $<HTMLInputElement>("#set-hotkey");
  const autostart = $<HTMLInputElement>("#set-autostart");
  const alwaysOnTop = $<HTMLInputElement>("#set-alwaysontop");
  const fontSize = $<HTMLInputElement>("#set-fontsize");
  const resultsWidth = $<HTMLInputElement>("#set-resultswidth");

  themeSel.value = settings.theme;
  precision.value = String(settings.precision);
  groupSep.value = settings.groupSeparator;
  decimalSep.value = settings.decimalSeparator;
  langSel.value = settings.language;
  hotkey.value = settings.hotkey;
  autostart.checked = settings.autostart;
  alwaysOnTop.checked = settings.alwaysOnTop;
  fontSize.value = String(settings.fontSize);
  resultsWidth.value = String(settings.resultsWidth);

  const save = () => {
    settings.theme = themeSel.value as SettingsData["theme"];
    settings.precision = Math.max(0, Math.min(15, Number(precision.value) || 2));
    settings.groupSeparator = groupSep.value;
    settings.decimalSeparator = decimalSep.value;
    // "1,234,56" is unreadable — a comma decimal forces a space group separator
    if (settings.decimalSeparator === settings.groupSeparator) {
      settings.groupSeparator = settings.decimalSeparator === "," ? " " : ",";
      groupSep.value = settings.groupSeparator;
    }
    settings.language = langSel.value;
    settings.fontSize = Math.max(10, Math.min(32, Number(fontSize.value) || 15));
    settings.resultsWidth = Math.max(20, Math.min(60, Number(resultsWidth.value) || 42));
    applySettings();
    void saveSettings(settings);
  };
  for (const el of [themeSel, precision, groupSep, decimalSep, langSel, fontSize]) {
    el.addEventListener("change", save);
  }
  resultsWidth.addEventListener("input", save); // live while sliding
  // hotkey is recorded, not typed
  hotkey.readOnly = true;
  hotkey.addEventListener("focus", () => {
    hotkey.value = "";
    hotkey.placeholder = t("pressKeys");
  });
  hotkey.addEventListener("blur", () => {
    hotkey.value = settings.hotkey;
    hotkey.placeholder = defaultSettingsData.hotkey;
  });
  hotkey.addEventListener("keydown", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      hotkey.blur();
      return;
    }
    const mods = [
      e.ctrlKey && "Ctrl",
      e.altKey && "Alt",
      e.shiftKey && "Shift",
      e.metaKey && "Super",
    ].filter(Boolean) as string[];
    if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) {
      hotkey.value = mods.length ? mods.join("+") + "+…" : "";
      return;
    }
    if (mods.length === 0) return; // a bare key is not a global hotkey
    const keyName = normalizeKeyName(e);
    if (!keyName) return;
    const combo = [...mods, keyName].join("+");
    const old = settings.hotkey;
    if (await registerHotkey(old, combo)) {
      settings.hotkey = combo;
      hotkey.value = combo;
      void saveSettings(settings);
    } else {
      // combo is taken by another app — restore the old one
      await registerHotkey(null, old);
      toast(t("hotkeyFailed"));
    }
    hotkey.blur();
  });
  autostart.addEventListener("change", async () => {
    settings.autostart = autostart.checked;
    await applyAutostart(settings.autostart);
    void saveSettings(settings);
  });
  alwaysOnTop.addEventListener("change", async () => {
    settings.alwaysOnTop = alwaysOnTop.checked;
    await applyAlwaysOnTop(settings.alwaysOnTop);
    void saveSettings(settings);
  });

  const binDays = $<HTMLInputElement>("#set-bindays");
  binDays.value = String(settings.deletedRetentionDays);
  binDays.addEventListener("change", () => {
    settings.deletedRetentionDays = Math.max(1, Math.min(365, Math.round(Number(binDays.value)) || 14));
    binDays.value = String(settings.deletedRetentionDays);
    void saveSettings(settings);
    void runBackups(settings.dataDir, settings.deletedRetentionDays); // prune right away
  });

  const dataDirBtn = $<HTMLButtonElement>("#set-datadir");
  const renderDataDir = () => {
    dataDirBtn.textContent = settings.dataDir ? settings.dataDir.split(/[\\/]/).pop() ?? settings.dataDir : t("defaultFolder");
    dataDirBtn.title = settings.dataDir || t("defaultFolder");
  };
  renderDataDir();
  dataDirBtn.addEventListener("click", async () => {
    const picked = await chooseFolder();
    if (!picked || picked === settings.dataDir) return;
    let strategy: "move" | "overwrite" | "use_existing" = "move";
    if (await dataDirHasDocuments(picked)) {
      const ans = await askModal(t("folderConflict"), t("useExisting"), t("replaceMine"));
      if (ans === null) return;
      strategy = ans === "a" ? "use_existing" : "overwrite";
    }
    try {
      await migrateDataDir(settings.dataDir, picked, strategy);
    } catch (e) {
      console.warn("migrate failed", e);
      toast(t("folderError"));
      return;
    }
    settings.dataDir = picked;
    setDataDir(picked);
    await saveSettings(settings);
    renderDataDir();
    if (strategy === "use_existing") {
      const fresh = await loadAppData(picked);
      if (fresh && fresh.docs.length > 0) {
        data = fresh;
        if (!data.docs.some((d) => d.id === data.activeId)) data.activeId = data.docs[0].id;
        switchDoc(data.activeId);
      }
    }
    toast(t("folderChanged"));
  });

  $("#open-settings").addEventListener("click", () => {
    $("#settings-panel").classList.toggle("hidden");
  });
  $("#close-settings").addEventListener("click", () => {
    $("#settings-panel").classList.add("hidden");
  });
  $("#open-extensions").addEventListener("click", () => void openExtensionsFolder());
  $("#open-backups").addEventListener("click", () => void openBackupsFolder(settings.dataDir));

  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (settings.theme === "system") applySettings();
  });
}

/** Physical key (e.code) → Tauri accelerator name, layout-independent (works on ru). */
function normalizeKeyName(e: KeyboardEvent): string | null {
  const code = e.code;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return code;
  if (/^F\d{1,2}$/.test(code)) return code;
  const map: Record<string, string> = {
    Space: "Space", Enter: "Enter", Backspace: "Backspace", Delete: "Delete",
    Tab: "Tab", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
    Minus: "-", Equal: "=", Comma: ",", Period: ".", Slash: "/", Backquote: "`",
    BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'",
  };
  return map[code] ?? null;
}

// ---------- tauri integration

async function registerHotkey(old: string | null, combo: string): Promise<boolean> {
  if (!isTauri()) return true;
  try {
    const gs = await import("@tauri-apps/plugin-global-shortcut");
    if (old) await gs.unregister(old).catch(() => {});
    await gs.register(combo, async (e) => {
      if (e.state !== "Pressed") return;
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      if (await win.isVisible()) {
        if (document.hasFocus()) {
          await win.hide();
        } else {
          await win.show();
          await win.setFocus();
        }
      } else {
        await win.show();
        await win.setFocus();
      }
    });
    return true;
  } catch (e) {
    console.warn("hotkey registration failed", e);
    return false;
  }
}

async function applyAutostart(enabled: boolean): Promise<void> {
  if (!isTauri()) return;
  try {
    const auto = await import("@tauri-apps/plugin-autostart");
    if (enabled) await auto.enable();
    else await auto.disable();
  } catch (e) {
    console.warn("autostart failed", e);
  }
}

async function applyAlwaysOnTop(enabled: boolean): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setAlwaysOnTop(enabled).catch((e) => console.warn("always-on-top failed", e));
}

async function refreshRates(force = false): Promise<void> {
  const info = $("#rates-info");
  info.classList.add("spin");
  const payload = await fetchRates(force);
  info.classList.remove("spin");
  if (payload) {
    liveRates = Object.fromEntries(
      Object.entries(payload.rates).map(([k, v]) => [k, Number(v)])
    );
    applyAllRates();
    workspace.invalidateAll();
    editor.refresh();
    ratesFetchedAt = payload.fetchedAt;
    if (force) toast(t("ratesUpdated"));
  }
  renderRatesInfo();
}

// ---------- market data

const MARKET_SYMBOLS = ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "NVDA", "META", "SBER", "GAZP"];

let marketPrices: Record<string, number> = {};
let marketFetchedAt = 0;

function applyAllRates(): void {
  const marketRates: Record<string, number> = {};
  for (const [sym, price] of Object.entries(marketPrices)) {
    if (price > 0) marketRates[sym] = 1 / price;
  }
  engine.setRates({ ...liveRates, ...marketRates });
}

async function refreshMarket(force = false): Promise<void> {
  if (!isTauri()) return;
  const info = $("#market-info") as HTMLElement;
  info.style.display = "";
  info.textContent = "Market…";
  const prices = await fetchMarketData(MARKET_SYMBOLS);
  if (Object.keys(prices).length > 0) {
    marketPrices = prices;
    marketFetchedAt = Math.floor(Date.now() / 1000);
    applyAllRates();
    workspace.invalidateAll();
    editor.refresh();
    if (force) toast(t("marketUpdated"));
  }
  renderMarketInfo();
}

// ---------- historical rates

const HIST_DATE_RE = /(?:on|на)\s+(\d{4}-\d{2}-\d{2})/gi;

async function fetchNeededHistoricalRates(text: string): Promise<void> {
  const dates = new Set<string>();
  for (const m of text.matchAll(HIST_DATE_RE)) dates.add(m[1]!);
  let fetched = false;
  for (const date of dates) {
    if (!engine.hasHistoricalRates(date)) {
      const rates = await fetchHistoricalRates(date);
      if (rates) { engine.setHistoricalRates(date, rates); fetched = true; }
    }
  }
  if (fetched) { workspace.invalidateAll(); editor.refresh(); }
}

function renderMarketInfo(): void {
  const el = $("#market-info") as HTMLElement;
  if (marketFetchedAt === 0) { el.style.display = "none"; return; }
  el.style.display = "";
  el.textContent = `Market: ${agoText(marketFetchedAt)} ↺`;
  el.title = t("refreshRates");
}

// ---------- status bar

/** total of the selection (≥2 lines) or of the whole sheet */
function renderTotal(): void {
  const line = $("#total-line");
  let results = lastResults;
  let label = t("total");
  if (selectedRange && selectedRange[1] > selectedRange[0]) {
    results = lastResults.slice(selectedRange[0], selectedRange[1] + 1);
    label = t("selection");
  }
  const total = engine.totalOf(results);
  if (total) {
    line.innerHTML = "";
    const lbl = document.createElement("span");
    lbl.className = "total-label";
    lbl.textContent = label;
    line.append(lbl, document.createTextNode(total));
    line.dataset.value = total;
    line.style.display = "";
  } else {
    line.style.display = "none";
    delete line.dataset.value;
  }
}

function agoText(unixSec: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unixSec);
  if (s < 90) return t("justNow");
  if (s < 3600) return t("minAgo").replace("{}", String(Math.round(s / 60)));
  if (s < 86400) return t("hourAgo").replace("{}", String(Math.round(s / 3600)));
  return t("dayAgo").replace("{}", String(Math.round(s / 86400)));
}

function renderRatesInfo(): void {
  const el = $("#rates-info");
  if (ratesFetchedAt > 0) {
    el.textContent = `${t("rates")}: ${agoText(ratesFetchedAt)}`;
    el.title = t("refreshRates");
  } else {
    el.textContent = `${t("rates")}: ⚠ offline`;
    el.title = t("ratesOffline");
  }
}

// ---------- PNG export

async function renderSheetImage(): Promise<void> {
  const dpr = window.devicePixelRatio || 1;
  const style = getComputedStyle(document.documentElement);
  const bgColor = style.getPropertyValue("--bg").trim() || "#ffffff";
  const fgColor = style.getPropertyValue("--fg").trim() || "#333333";
  const resultColor = style.getPropertyValue("--result").trim() || "#d57d2c";
  const monoFont = style.getPropertyValue("--mono").trim() || "monospace";
  const fontSize = settings.fontSize;
  const lineH = Math.round(fontSize * 1.7);
  const padX = 20, padTop = 16, padBot = 16;

  const doc = workspace.evaluateSheet(activeDoc().id, editor.getText());
  const rawLines = editor.getText().split("\n");

  const canvas = document.createElement("canvas");
  const ctx2 = canvas.getContext("2d")!;
  ctx2.font = `${fontSize}px ${monoFont}`;
  const maxWidth = rawLines.reduce((m, l) => Math.max(m, ctx2.measureText(l).width), 0) + padX * 4 + 150;
  const w = Math.max(400, maxWidth);
  const h = padTop + rawLines.length * lineH + padBot;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx2.scale(dpr, dpr);

  ctx2.fillStyle = bgColor;
  ctx2.fillRect(0, 0, w, h);

  ctx2.font = `${fontSize}px ${monoFont}`;
  for (let i = 0; i < rawLines.length; i++) {
    const y = padTop + i * lineH + fontSize;
    ctx2.fillStyle = fgColor;
    ctx2.fillText(rawLines[i], padX, y);
    const res = doc[i]?.text;
    if (res) {
      ctx2.fillStyle = resultColor;
      const rx = w - padX - ctx2.measureText(res).width;
      ctx2.fillText(res, rx, y);
    }
  }

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!blob) { toast(t("imageFailed")); return; }

  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast(t("imageCopied"));
  } catch {
    // clipboard API failed — save to file
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({ filters: [{ name: "PNG Image", extensions: ["png"] }] });
      if (path) {
        const buf = await blob.arrayBuffer();
        const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        await writeImageFile(path, b64);
        toast(t("saved"));
      }
    } catch (e) {
      toast(t("imageFailed"));
    }
  }
}

// ---------- modal

/** two-button modal; resolves "a" | "b" | null (click outside = cancel) */
function askModal(msg: string, aLabel: string, bLabel: string): Promise<"a" | "b" | null> {
  return new Promise((resolve) => {
    const modal = $("#modal");
    const a = $("#modal-a");
    const b = $("#modal-b");
    $("#modal-msg").textContent = msg;
    a.textContent = aLabel;
    b.textContent = bLabel;
    a.classList.add("primary");
    modal.classList.remove("hidden");
    const done = (res: "a" | "b" | null) => {
      modal.classList.add("hidden");
      a.onclick = b.onclick = modal.onclick = null;
      resolve(res);
    };
    a.onclick = () => done("a");
    b.onclick = () => done("b");
    modal.onclick = (e) => {
      if (e.target === modal) done(null);
    };
  });
}

// ---------- toast

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function toast(msg: string): void {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 1200);
}

// ---------- boot

async function boot(): Promise<void> {
  settings = await loadSettings();
  if (!localStorage.getItem("summarum.langInit") && settings.language === "en") {
    settings.language = detectLang();
    localStorage.setItem("summarum.langInit", "1");
  }

  engine = new SumEngine({ precision: settings.precision, groupSeparator: settings.groupSeparator });

  // snapshots run before the app writes anything
  setDataDir(settings.dataDir);
  await runBackups(settings.dataDir, settings.deletedRetentionDays);

  const stored = await loadAppData(settings.dataDir);
  // a corrupt or foreign documents.json must not crash the boot
  if (stored && Array.isArray(stored.docs) && stored.docs.length > 0 && stored.contents && typeof stored.contents === "object") {
    data = stored;
  } else {
    const id = uid();
    data = { docs: [{ id, title: "Sample" }], activeId: id, contents: { [id]: welcomeText(settings.language) } };
  }
  if (!data.docs.some((d) => d.id === data.activeId)) data.activeId = data.docs[0].id;

  const scripts = await loadExtensionScripts();
  runExtensions(engine, scripts);

  workspace = new Workspace(engine, () =>
    data.docs.map((d) => ({ id: d.id, title: d.title, text: data.contents[d.id] ?? "" })),
  );

  editor = new SumEditor(
    $("#editor"),
    $("#results"),
    engine,
    {
      onChange(text) {
        const doc = activeDoc();
        data.contents[doc.id] = text;
        workspace.invalidate(doc.id);
        if (!doc.customTitle) {
          doc.title = titleFromContent(text);
          syncTitleField();
        }
        renderDocList();
        saveAppData(data);
        void fetchNeededHistoricalRates(text);
      },
      onCopy(text) {
        void navigator.clipboard.writeText(text);
        toast(t("copied"));
      },
      onResults(results) {
        lastResults = results;
        renderTotal();
      },
      onSelection(range) {
        selectedRange = range;
        renderTotal();
      },
    },
    (text) => workspace.evaluateSheet(activeDoc().id, text),
    data.contents[data.activeId] ?? "",
  );

  applySettings(); // sets the language before bindSettingsUI renders dynamic labels
  bindSettingsUI();
  renderDocList();
  syncTitleField();

  const titleField = $<HTMLInputElement>("#doc-title");
  titleField.addEventListener("change", () => {
    const doc = activeDoc();
    const oldTitle = doc.title;
    const v = titleField.value.trim();
    if (v) {
      doc.title = v.slice(0, 60);
      doc.customTitle = true;
      const rewrites = workspace.renameSheet(doc.id, oldTitle, doc.title);
      for (const r of rewrites) data.contents[r.id] = r.text;
      workspace.invalidateAll();
    } else {
      doc.customTitle = false;
      doc.title = titleFromContent(data.contents[doc.id] ?? "");
      workspace.invalidateAll();
    }
    syncTitleField();
    renderDocList();
    saveAppData(data);
  });
  titleField.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "Escape") titleField.blur();
  });

  $("#total-line").addEventListener("click", () => {
    const v = $("#total-line").dataset.value;
    if (v) {
      void navigator.clipboard.writeText(v);
      toast(t("copied"));
    }
  });

  $("#open-search").addEventListener("click", () => openSearch());
  const searchInput = $<HTMLInputElement>("#search-input");
  searchInput.addEventListener("input", () => {
    renderSearchResults(searchInput.value, searchAllSheets(searchInput.value));
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeSearch();
    } else if (e.key === "Enter") {
      $("#search-results").querySelector<HTMLElement>(".search-item")?.click();
    }
  });
  $("#search-overlay").addEventListener("mousedown", (e) => {
    if (e.target === $("#search-overlay")) closeSearch();
  });

  if (isTauri()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    $("#win-min").addEventListener("click", () => void win.minimize());
    $("#win-close").addEventListener("click", () => void win.hide());
  } else {
    $("#win-controls").style.display = "none";
  }

  $("#toggle-sidebar").addEventListener("click", () => {
    settings.sidebarVisible = !settings.sidebarVisible;
    $("#sidebar").classList.toggle("hidden", !settings.sidebarVisible);
    void saveSettings(settings);
  });
  $("#new-doc").addEventListener("click", () => newDoc());

  document.addEventListener("mousedown", (e) => {
    const target = e.target as HTMLElement;
    const panel = $("#settings-panel");
    if (!panel.classList.contains("hidden") && !target.closest("#settings-panel") && !target.closest("#open-settings")) {
      panel.classList.add("hidden");
    }
    if (!settings.sidebarVisible) return;
    if (target.closest("#sidebar") || target.closest("#toggle-sidebar")) return;
    settings.sidebarVisible = false;
    $("#sidebar").classList.add("hidden");
    void saveSettings(settings);
  });

  const divider = $("#col-divider");
  const wrap = $("#editor-wrap");
  divider.addEventListener("mousedown", (e) => {
    e.preventDefault();
    divider.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    const onMove = (ev: MouseEvent) => {
      const rect = wrap.getBoundingClientRect();
      const pct = ((rect.right - ev.clientX) / rect.width) * 100;
      settings.resultsWidth = Math.round(Math.max(20, Math.min(60, pct)));
      wrap.style.setProperty("--results-width", `${settings.resultsWidth}%`);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      divider.classList.remove("dragging");
      document.body.style.cursor = "";
      $<HTMLInputElement>("#set-resultswidth").value = String(settings.resultsWidth);
      void saveSettings(settings);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      newDoc();
    }
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "w") {
      e.preventDefault();
      void closeActiveDoc();
    }
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "b") {
      e.preventDefault();
      $("#toggle-sidebar").click();
    }
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      openSearch();
    }
      if (e.ctrlKey && e.shiftKey && e.code === "KeyC") {
      e.preventDefault();
      void navigator.clipboard.writeText(editor.getSheetWithResults());
      toast(t("copied"));
    }
  });

  // export button + dropdown
  const exportBtn = $("#export-btn");
  const exportMenu = $("#export-menu");
  exportBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    exportMenu.classList.toggle("hidden");
  });
  document.addEventListener("click", () => exportMenu.classList.add("hidden"));
  exportMenu.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-action]");
    if (!btn) return;
    exportMenu.classList.add("hidden");
    const action = btn.dataset.action;
    if (action === "image") {
      void renderSheetImage();
    } else if (action === "copy") {
      void navigator.clipboard.writeText(editor.getSheetWithResults());
      toast(t("copied"));
    } else if (action === "print") {
      window.print();
    } else if (isTauri()) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { invoke } = await import("@tauri-apps/api/core");
      const isSum = action === "save-sum";
      const path = await save({
        filters: isSum
          ? [{ name: "Summarum Sheet", extensions: ["sum"] }]
          : [{ name: "Text file", extensions: ["txt"] }],
      });
      if (path) {
        const content = isSum ? editor.getText() : editor.getSheetWithResults();
        await invoke("write_text_file", { path, contents: content });
        toast(t("saved"));
      }
    }
  });

  $("#rates-info").addEventListener("click", () => void refreshRates(true));
  $("#market-info").addEventListener("click", () => void refreshMarket(true));
  setInterval(renderRatesInfo, 60_000);
  setInterval(renderMarketInfo, 60_000);

  void onFileDrop((content) => newDoc(content));

  await registerHotkey(null, settings.hotkey);
  if (settings.autostart) await applyAutostart(true);
  if (settings.alwaysOnTop) await applyAlwaysOnTop(true);
  void onAppQuit(() => flushAppData());
  void refreshRates();
  setInterval(() => void refreshRates(), 60 * 60 * 1000);
  void refreshMarket();
  setInterval(() => void refreshMarket(), 15 * 60 * 1000);

  const launched = await getLaunchFile();
  if (launched) newDoc(launched);
  void onOpenFile((content) => newDoc(content));

  editor.focus();

  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const hidden = await invoke<boolean>("is_hidden_launch");
    if (!hidden) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().show();
    }
  }

  void checkUpdate();
}

async function checkUpdate(): Promise<void> {
  const update = await checkForUpdate();
  if (!update) return;
  const choice = await askModal(t("updateAvailable").replace("{}", update.version), t("updateInstall"), t("updateLater"));
  if (choice !== "a") return;
  toast(t("updateInstalling"));
  try {
    await update.install();
  } catch {
    toast(t("updateFailed"));
  }
}

void boot();
