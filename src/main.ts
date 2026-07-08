/** App bootstrap: engine + editor + documents + settings + Tauri glue. */
import "./ui/app.css";
import { SumEngine } from "./engine";
import { SumEditor } from "./ui/editor";
import {
  AppData, DocMeta, SettingsData, defaultSettingsData,
  loadAppData, saveAppData, flushAppData, onAppQuit, loadSettings, saveSettings,
  fetchRates, fetchMarketData, fetchHistoricalRates, loadExtensionScripts, openExtensionsFolder, isTauri,
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
import { exportSheetImage } from "./ui/export";
import { initSearch, SearchController } from "./ui/search";
import pkg from "../package.json";

function welcomeText(lang: string): string {
  const sample = (lang === "ru" ? RU : EN).Samples?.["sample.welcome"];
  return (sample ?? "# Sample\n8 / (45 - 20%)\n5 inches in cm\n$9 in Euro") + "\n";
}

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

let engine: SumEngine;
let editor: SumEditor;
let workspace: Workspace;
let search: SearchController;
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

/** drag id -> drop-target id; no-op across the pinned/unpinned boundary */
function reorderDoc(srcId: string, targetId: string): void {
  if (srcId === targetId) return;
  const src = data.docs.find((d) => d.id === srcId);
  const target = data.docs.find((d) => d.id === targetId);
  if (!src || !target || !!src.pinned !== !!target.pinned) return;
  data.docs = data.docs.filter((d) => d.id !== srcId);
  const targetIdx = data.docs.findIndex((d) => d.id === targetId);
  data.docs.splice(targetIdx, 0, src);
  saveAppData(data);
  renderDocList();
}

function renderDocList(): void {
  const list = $("#doc-list");
  list.replaceChildren();
  const frag = document.createDocumentFragment();
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
      b.setAttribute("aria-label", title);
      b.addEventListener("click", (e) => { e.stopPropagation(); cb(); });
      return b;
    };

    el.appendChild(mkBtn("pin-btn" + (doc.pinned ? " active" : ""), "📌", doc.pinned ? t("unpin") : t("pin"), () => pinDoc(doc.id)));

    // Reordering uses plain mouse tracking, not the native HTML5 drag API —
    // Tauri's window-level file-drop hook (dragDropEnabled, needed for
    // dropping .numi files from Explorer) intercepts WebView2's own drag
    // sessions, so draggable="true" elements never get a valid drop target
    // and the OS always shows a "not allowed" cursor.
    let dragging = false;
    let suppressClick = false;
    el.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      const startY = e.clientY;
      const onMove = (ev: MouseEvent) => {
        if (!dragging) {
          if (Math.abs(ev.clientY - startY) < 4) return;
          dragging = true;
          suppressClick = true;
          el.classList.add("dragging");
          document.body.style.cursor = "grabbing";
        }
        const items = [...list.querySelectorAll<HTMLElement>(".doc-item")];
        for (const item of items) item.classList.remove("drag-over");
        const over = items.find((item) => {
          if (item === el) return false;
          const r = item.getBoundingClientRect();
          return ev.clientY >= r.top && ev.clientY <= r.bottom;
        });
        if (over) {
          const overDoc = data.docs.find((d) => d.id === over.dataset.docId);
          if (overDoc && !!overDoc.pinned === !!doc.pinned) over.classList.add("drag-over");
        }
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (dragging) {
          const target = list.querySelector<HTMLElement>(".doc-item.drag-over");
          for (const item of list.querySelectorAll(".doc-item")) item.classList.remove("drag-over", "dragging");
          document.body.style.cursor = "";
          if (target?.dataset.docId) reorderDoc(doc.id, target.dataset.docId);
        }
        dragging = false;
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
    el.addEventListener("click", () => {
      if (suppressClick) { suppressClick = false; return; }
      switchDoc(doc.id);
    });
    el.dataset.docId = doc.id;

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
    frag.appendChild(el);
  }
  list.appendChild(frag);
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

// ---------- settings

function applySettings(): void {
  const theme = settings.theme === "system"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : settings.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty("--editor-font-size", `${settings.fontSize}px`);
  $("#editor-wrap").style.setProperty("--results-width", `${settings.resultsWidth}%`);
  setLang(settings.language);
  const searchInput = $<HTMLInputElement>("#search-input");
  searchInput.placeholder = t("searchPlaceholder");
  searchInput.setAttribute("aria-label", t("searchPlaceholder"));
  engine.updateSettings({
    precision: settings.precision,
    groupSeparator: settings.groupSeparator,
    decimalSeparator: settings.decimalSeparator,
    dateFormat: settings.dateFormat,
  });
  editor?.refresh();
  syncTitleField();
  $<HTMLElement>("#sidebar").classList.toggle("hidden", !settings.sidebarVisible);
}

function bindFormattingSettings(): void {
  const themeSel = $<HTMLSelectElement>("#set-theme");
  const precision = $<HTMLInputElement>("#set-precision");
  const groupSep = $<HTMLSelectElement>("#set-groupsep");
  const decimalSep = $<HTMLSelectElement>("#set-decimalsep");
  const dateFmt = $<HTMLSelectElement>("#set-dateformat");
  const langSel = $<HTMLSelectElement>("#set-lang");
  const fontSize = $<HTMLInputElement>("#set-fontsize");
  const resultsWidth = $<HTMLInputElement>("#set-resultswidth");

  themeSel.value = settings.theme;
  precision.value = String(settings.precision);
  groupSep.value = settings.groupSeparator;
  decimalSep.value = settings.decimalSeparator;
  dateFmt.value = settings.dateFormat;
  langSel.value = settings.language;
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
    settings.dateFormat = dateFmt.value as SettingsData["dateFormat"];
    settings.language = langSel.value;
    settings.fontSize = Math.max(10, Math.min(32, Number(fontSize.value) || 15));
    settings.resultsWidth = Math.max(20, Math.min(60, Number(resultsWidth.value) || 42));
    applySettings();
    void saveSettings(settings);
  };

  for (const el of [themeSel, precision, groupSep, decimalSep, dateFmt, langSel, fontSize]) {
    el.addEventListener("change", save);
  }
  resultsWidth.addEventListener("input", save); // live while sliding

  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (settings.theme === "system") applySettings();
  });
}

function bindHotkeySettings(): void {
  const hotkey = $<HTMLInputElement>("#set-hotkey");
  hotkey.value = settings.hotkey;
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
}

function bindBehaviorSettings(): void {
  const autostart = $<HTMLInputElement>("#set-autostart");
  const alwaysOnTop = $<HTMLInputElement>("#set-alwaysontop");
  const binDays = $<HTMLInputElement>("#set-bindays");
  const autoUpdate = $<HTMLInputElement>("#set-autoupdate");

  autostart.checked = settings.autostart;
  alwaysOnTop.checked = settings.alwaysOnTop;
  binDays.value = String(settings.deletedRetentionDays);
  autoUpdate.checked = settings.autoUpdateEnabled;

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
  binDays.addEventListener("change", () => {
    settings.deletedRetentionDays = Math.max(1, Math.min(365, Math.round(Number(binDays.value)) || 14));
    binDays.value = String(settings.deletedRetentionDays);
    void saveSettings(settings);
    void runBackups(settings.dataDir, settings.deletedRetentionDays); // prune right away
  });
  autoUpdate.addEventListener("change", () => {
    settings.autoUpdateEnabled = autoUpdate.checked;
    void saveSettings(settings);
  });

  void showAppVersion();
}

function bindDataDirSettings(): void {
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
}

function bindSettingsNavigation(): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>("#settings-tabs .tab");
  const tabPanels = document.querySelectorAll<HTMLElement>(".settings-tabpanel");
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      for (const other of tabs) other.classList.toggle("active", other === tab);
      for (const panel of tabPanels) panel.classList.toggle("hidden", panel.dataset.tabpanel !== tab.dataset.tab);
    });
  }

  $("#open-settings").addEventListener("click", () => {
    $("#settings-panel").classList.toggle("hidden");
  });
  $("#close-settings").addEventListener("click", () => {
    $("#settings-panel").classList.add("hidden");
  });
  $("#open-extensions").addEventListener("click", () => void openExtensionsFolder());
  $("#open-backups").addEventListener("click", () => void openBackupsFolder(settings.dataDir));
  $("#check-update").addEventListener("click", () => void checkUpdate(true));
}

function bindSettingsUI(): void {
  bindFormattingSettings();
  bindHotkeySettings();
  bindBehaviorSettings();
  bindDataDirSettings();
  bindSettingsNavigation();
}

/** tauri.conf.json's version is the source of truth for an actual build; package.json is the vite-dev fallback */
async function showAppVersion(): Promise<void> {
  let version = pkg.version;
  if (isTauri()) {
    const { getVersion } = await import("@tauri-apps/api/app");
    version = await getVersion();
  }
  $("#app-version").textContent = `${t("version")} ${version}`;
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

// Yahoo delisted Russian tickers (SBER/GAZP) in 2022 — dropped, they always miss.
const MARKET_SYMBOLS = ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "NVDA", "META"];

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
  info.classList.add("spin");
  info.textContent = t("market");
  const prices = await fetchMarketData(MARKET_SYMBOLS);
  info.classList.remove("spin");
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
  const datesToFetch = Array.from(dates).filter((date) => !engine.hasHistoricalRates(date));
  let fetched = false;
  if (datesToFetch.length > 0) {
    const results = await Promise.all(
      datesToFetch.map(async (date) => {
        const rates = await fetchHistoricalRates(date);
        return { date, rates };
      })
    );
    for (const { date, rates } of results) {
      if (rates) {
        engine.setHistoricalRates(date, rates);
        fetched = true;
      }
    }
  }
  if (fetched) { workspace.invalidateAll(); editor.refresh(); }
}

function renderMarketInfo(): void {
  const el = $("#market-info") as HTMLElement;
  if (marketFetchedAt === 0) { el.style.display = "none"; return; }
  el.style.display = "";
  el.textContent = `${t("market")}: ${agoText(marketFetchedAt)} ↺`;
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

async function initSettings(): Promise<void> {
  settings = await loadSettings();
  if (!localStorage.getItem("summarum.langInit") && settings.language === "en") {
    settings.language = detectLang();
    localStorage.setItem("summarum.langInit", "1");
  }

  // snapshots run before the app writes anything
  setDataDir(settings.dataDir);
  await runBackups(settings.dataDir, settings.deletedRetentionDays);
}

async function initDataAndEngine(): Promise<void> {
  engine = new SumEngine({
    precision: settings.precision,
    groupSeparator: settings.groupSeparator,
    decimalSeparator: settings.decimalSeparator,
    dateFormat: settings.dateFormat,
  });

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
  // the editor above was seeded directly with initialText (not via switchDoc),
  // so a reopened sheet with "on 2024-01-01" needs its own historical-rate fetch
  void fetchNeededHistoricalRates(data.contents[data.activeId] ?? "");

  search = initSearch({
    engine,
    workspace,
    docs: () => data.docs.map((d) => ({ id: d.id, title: d.title, text: data.contents[d.id] ?? "" })),
    t,
    onOpen: (docId, line) => {
      if (docId !== data.activeId) switchDoc(docId);
      editor.goToLine(line);
    },
  });
}

async function initUI(): Promise<void> {

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

  $("#open-search").addEventListener("click", () => search.open());

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
      search.open();
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
      void exportSheetImage({
        lines: editor.getText().split("\n"),
        results: workspace.evaluateSheet(activeDoc().id, editor.getText()),
        fontSize: settings.fontSize,
        toast,
        t,
      });
    } else if (action === "copy") {
      void navigator.clipboard.writeText(editor.getSheetWithResults());
      toast(t("copied"));
    } else if (action === "print") {
      window.print();
    } else if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      const isSum = action === "save-sum";
      const content = isSum ? editor.getText() : editor.getSheetWithResults();
      try {
        const saved = await invoke<boolean>("write_text_file", { contents: content, isSum });
        if (saved) {
          toast(t("saved"));
        }
      } catch {
        toast(t("imageFailed"));
      }
    }
  });

  $("#rates-info").addEventListener("click", () => void refreshRates(true));
  $("#market-info").addEventListener("click", () => void refreshMarket(true));
  setInterval(renderRatesInfo, 60_000);
  setInterval(renderMarketInfo, 60_000);

  void onFileDrop((content) => newDoc(content));

  if (!(await registerHotkey(null, settings.hotkey))) toast(t("hotkeyFailed"));
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

  if (settings.autoUpdateEnabled) void checkUpdate();
  // a tray app can stay running for weeks without a cold restart, and the
  // update check above only ever runs once at boot — recheck periodically
  // so a long-lived process still notices new releases; re-read the setting
  // on every tick since the user can flip it while the app is running
  setInterval(() => { if (settings.autoUpdateEnabled) void checkUpdate(); }, 6 * 60 * 60 * 1000);
}

async function boot(): Promise<void> {
  await initSettings();
  await initDataAndEngine();
  await initUI();
}

/** manual = true when the user clicked "Check for updates" — only then report "up to date" / "check failed" */
async function checkUpdate(manual = false): Promise<void> {
  const result = await checkForUpdate();
  if (result === "error") {
    if (manual) toast(t("updateCheckFailed"));
    return;
  }
  if (!result) {
    if (manual) toast(t("upToDate"));
    return;
  }
  const choice = await askModal(t("updateAvailable").replace("{}", result.version), t("updateInstall"), t("updateLater"));
  if (choice !== "a") return;
  toast(t("updateInstalling"));
  try {
    await result.install();
  } catch {
    toast(t("updateFailed"));
  }
}

void boot();
