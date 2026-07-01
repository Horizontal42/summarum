// Storage: Tauri commands in the app, localStorage fallback for `vite dev`.

export interface DocMeta {
  id: string;
  title: string;
  /** user renamed the document — stop deriving the title from the first line */
  customTitle?: boolean;
  pinned?: boolean;
}

export interface AppData {
  docs: DocMeta[];
  activeId: string;
  contents: Record<string, string>;
}

export interface SettingsData {
  theme: "system" | "light" | "dark";
  precision: number;
  groupSeparator: string;
  decimalSeparator: string;
  language: string;
  hotkey: string;
  autostart: boolean;
  fontSize: number;
  sidebarVisible: boolean;
  /** results column width, % of the editor area */
  resultsWidth: number;
  /** custom folder for documents.json + backups; "" = default app data dir */
  dataDir: string;
  /** how long deleted sheets stay in backups/deleted */
  deletedRetentionDays: number;
  /** keep the window above others */
  alwaysOnTop: boolean;
}

export const defaultSettingsData: SettingsData = {
  theme: "system",
  precision: 2,
  groupSeparator: ",",
  decimalSeparator: ".",
  language: "en",
  hotkey: "Ctrl+Alt+N",
  autostart: false,
  fontSize: 15,
  sidebarVisible: false,
  resultsWidth: 42,
  dataDir: "",
  deletedRetentionDays: 14,
  alwaysOnTop: false,
};

/** "" -> undefined for the Rust side (default app data dir) */
function dirArg(dataDir: string): string | null {
  return dataDir.trim() ? dataDir : null;
}

export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

// ---------- settings

export async function loadSettings(): Promise<SettingsData> {
  try {
    const raw = isTauri()
      ? await invoke<string | null>("load_file", { name: "settings.json" })
      : localStorage.getItem("summarum.settings");
    if (raw) return { ...defaultSettingsData, ...JSON.parse(raw) };
  } catch (e) {
    console.warn("loadSettings failed", e);
  }
  return { ...defaultSettingsData };
}

export async function saveSettings(s: SettingsData): Promise<void> {
  const raw = JSON.stringify(s, null, 2);
  if (isTauri()) await invoke("save_file", { name: "settings.json", contents: raw });
  else localStorage.setItem("summarum.settings", raw);
}

// ---------- documents

export async function loadAppData(dataDir: string): Promise<AppData | null> {
  try {
    const raw = isTauri()
      ? await invoke<string | null>("load_documents", { dir: dirArg(dataDir) })
      : localStorage.getItem("summarum.documents");
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn("loadAppData failed", e);
  }
  return null;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingData: AppData | null = null;
let currentDataDir = "";

export function setDataDir(dataDir: string): void {
  currentDataDir = dataDir;
}

export function saveAppData(data: AppData): void {
  // debounce: autosave on every keystroke without disk churn
  pendingData = data;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushAppData(), 400);
}

/** write whatever is pending right now (used before quitting) */
export async function flushAppData(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!pendingData) return;
  const raw = JSON.stringify(pendingData);
  pendingData = null;
  try {
    if (isTauri()) await invoke("save_documents", { dir: dirArg(currentDataDir), contents: raw });
    else localStorage.setItem("summarum.documents", raw);
  } catch (e) {
    console.warn("saveAppData failed", e);
  }
}

/** quit initiated from the tray: flush unsaved edits, then exit for real */
export async function onAppQuit(cb: () => Promise<void>): Promise<void> {
  if (!isTauri()) return;
  const { listen } = await import("@tauri-apps/api/event");
  await listen("app-quit", () => void cb().finally(() => void invoke("exit_app")));
}

// ---------- backups & data folder

export async function runBackups(dataDir: string, retentionDays: number): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("run_backups", { dir: dirArg(dataDir), retentionDays });
  } catch (e) {
    console.warn("runBackups failed", e);
  }
}

export async function backupDeletedSheet(dataDir: string, title: string, contents: string): Promise<void> {
  if (!isTauri() || !contents.trim()) return;
  try {
    await invoke("backup_deleted_sheet", { dir: dirArg(dataDir), title, contents });
  } catch (e) {
    console.warn("backupDeletedSheet failed", e);
  }
}

export async function openBackupsFolder(dataDir: string): Promise<void> {
  if (isTauri()) await invoke("open_backups_folder", { dir: dirArg(dataDir) });
}

export async function chooseFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, multiple: false });
  return typeof picked === "string" ? picked : null;
}

export async function dataDirHasDocuments(dir: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("data_dir_has_documents", { dir });
}

export type MigrateStrategy = "move" | "overwrite" | "use_existing";

export async function migrateDataDir(oldDir: string, newDir: string, strategy: MigrateStrategy): Promise<void> {
  if (!isTauri()) return;
  await invoke("migrate_data_dir", { oldDir: dirArg(oldDir), newDir, strategy });
}

// ---------- rates

export interface RatesPayload {
  date: string;
  rates: Record<string, number>;
  /** unix seconds when the rates were actually fetched */
  fetchedAt: number;
}

export async function fetchRates(force = false): Promise<RatesPayload | null> {
  try {
    if (isTauri()) {
      return await invoke<RatesPayload>("fetch_rates", { force });
    }
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const json = await res.json();
    if (json?.result === "success") {
      return { date: json.time_last_update_utc, rates: json.rates, fetchedAt: Math.floor(Date.now() / 1000) };
    }
  } catch (e) {
    console.warn("fetchRates failed", e);
  }
  return null;
}

// ---------- image export

export async function writeImageFile(path: string, dataBase64: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("write_image_file", { path, dataBase64 });
}

// ---------- market data

export async function fetchMarketData(symbols: string[]): Promise<Record<string, number>> {
  if (!isTauri() || symbols.length === 0) return {};
  try {
    return await invoke<Record<string, number>>("fetch_market_data", { symbols });
  } catch (e) {
    console.warn("fetchMarketData failed", e);
    return {};
  }
}

// ---------- extensions

export async function loadExtensionScripts(): Promise<{ name: string; code: string }[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<{ name: string; code: string }[]>("load_extensions");
  } catch (e) {
    console.warn("loadExtensions failed", e);
    return [];
  }
}

export async function openExtensionsFolder(): Promise<void> {
  if (isTauri()) await invoke("open_extensions_folder");
}

// ---------- .numi file association

export async function getLaunchFile(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string | null>("get_launch_file");
  } catch {
    return null;
  }
}

export async function onOpenFile(cb: (content: string) => void): Promise<void> {
  if (!isTauri()) return;
  const { listen } = await import("@tauri-apps/api/event");
  await listen<string>("open-file", (e) => cb(e.payload));
}

/** Drag & drop of .numi/.txt/.md files: Tauri native events or HTML5 fallback. */
export async function onFileDrop(cb: (content: string) => void): Promise<void> {
  if (isTauri()) {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().onDragDropEvent(async (event) => {
      if (event.payload.type !== "drop") return;
      for (const path of event.payload.paths) {
        try {
          const content = await invoke<string>("read_text_file", { path });
          cb(content);
        } catch (e) {
          console.warn("file drop rejected", path, e);
        }
      }
    });
    return;
  }
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", async (e) => {
    e.preventDefault();
    for (const f of e.dataTransfer?.files ?? []) {
      if (/\.(numi|txt|md)$/i.test(f.name)) cb(await f.text());
    }
  });
}
