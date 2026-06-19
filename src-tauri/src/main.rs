// Summarum — Tauri shell: tray, hide-to-tray window, app-data storage,
// currency rates fetching with an on-disk cache, extension script loading.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_opener::OpenerExt;

const RATES_TTL_SECS: u64 = 3600;
const SAMPLE_JS: &str = include_str!("../extension-sample.js");

fn data_dir(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().expect("no app data dir");
    fs::create_dir_all(&dir).ok();
    dir
}

/// Documents live either in the default app-data dir or in a user-chosen
/// folder (settings stay in app-data — the path itself is stored there).
fn docs_dir(app: &AppHandle, dir: &Option<String>) -> PathBuf {
    match dir {
        Some(d) if !d.trim().is_empty() => {
            let p = PathBuf::from(d);
            fs::create_dir_all(&p).ok();
            p
        }
        _ => data_dir(app),
    }
}

fn safe_name(name: &str) -> bool {
    !name.is_empty() && !name.contains(['/', '\\', ':']) && !name.contains("..")
}

/// write via a temp file + rename so a crash mid-write cannot corrupt the target
fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_file(app: AppHandle, name: String, contents: String) -> Result<(), String> {
    if !safe_name(&name) {
        return Err("bad file name".into());
    }
    write_atomic(&data_dir(&app).join(name), &contents)
}

#[tauri::command]
fn load_file(app: AppHandle, name: String) -> Result<Option<String>, String> {
    if !safe_name(&name) {
        return Err("bad file name".into());
    }
    let path = data_dir(&app).join(name);
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path)
        .map(Some)
        .map_err(|e| e.to_string())
}

#[derive(Serialize, Deserialize, Clone)]
struct RatesPayload {
    date: String,
    rates: serde_json::Map<String, serde_json::Value>,
    #[serde(rename = "fetchedAt", default)]
    fetched_at: u64,
}

/// top cryptocurrencies fetched from CoinGecko (code, gecko id)
const CRYPTO: &[(&str, &str)] = &[
    ("BTC", "bitcoin"),
    ("ETH", "ethereum"),
    ("SOL", "solana"),
    ("BNB", "binancecoin"),
    ("XRP", "ripple"),
    ("ADA", "cardano"),
    ("DOGE", "dogecoin"),
    ("TRX", "tron"),
    ("TON", "the-open-network"),
    ("DOT", "polkadot"),
    ("LTC", "litecoin"),
    ("AVAX", "avalanche-2"),
    ("LINK", "chainlink"),
    ("UNI", "uniswap"),
    ("XLM", "stellar"),
    ("XMR", "monero"),
    ("ATOM", "cosmos"),
    ("BCH", "bitcoin-cash"),
    ("NEAR", "near"),
    ("USDT", "tether"),
    ("USDC", "usd-coin"),
];

#[derive(Serialize, Deserialize)]
struct RatesCache {
    fetched_at: u64,
    payload: RatesPayload,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

fn read_rates_cache(app: &AppHandle) -> Option<RatesCache> {
    let raw = fs::read_to_string(data_dir(app).join("rates.json")).ok()?;
    serde_json::from_str(&raw).ok()
}

async fn fetch_rates_online() -> Result<RatesPayload, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let body: serde_json::Value = client
        .get("https://open.er-api.com/v6/latest/USD")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    if body["result"] != "success" {
        return Err("rates api error".into());
    }
    let mut rates = body["rates"].as_object().cloned().ok_or("no rates")?;

    // crypto via CoinGecko (er-api has no crypto); best-effort
    let ids: Vec<&str> = CRYPTO.iter().map(|(_, id)| *id).collect();
    let url = format!(
        "https://api.coingecko.com/api/v3/simple/price?ids={}&vs_currencies=usd",
        ids.join(",")
    );
    if let Ok(resp) = client.get(&url).send().await {
        if let Ok(json) = resp.json::<serde_json::Value>().await {
            for (code, id) in CRYPTO {
                if let Some(price) = json[id]["usd"].as_f64() {
                    if price > 0.0 {
                        rates.insert((*code).into(), serde_json::json!(1.0 / price));
                    }
                }
            }
        }
    }

    Ok(RatesPayload {
        date: body["time_last_update_utc"]
            .as_str()
            .unwrap_or("")
            .to_string(),
        rates,
        fetched_at: now_secs(),
    })
}

#[tauri::command]
async fn fetch_rates(app: AppHandle, force: bool) -> Result<RatesPayload, String> {
    if !force {
        if let Some(cache) = read_rates_cache(&app) {
            if now_secs().saturating_sub(cache.fetched_at) < RATES_TTL_SECS {
                let mut payload = cache.payload;
                payload.fetched_at = cache.fetched_at;
                return Ok(payload);
            }
        }
    }
    match fetch_rates_online().await {
        Ok(payload) => {
            let cache = RatesCache {
                fetched_at: now_secs(),
                payload: payload.clone(),
            };
            if let Ok(raw) = serde_json::to_string(&cache) {
                write_atomic(&data_dir(&app).join("rates.json"), &raw).ok();
            }
            Ok(payload)
        }
        Err(e) => read_rates_cache(&app)
            .map(|c| {
                let mut payload = c.payload;
                payload.fetched_at = c.fetched_at;
                payload
            })
            .ok_or(e),
    }
}

// ---------- documents in the (possibly custom) data folder

#[tauri::command]
fn load_documents(app: AppHandle, dir: Option<String>) -> Result<Option<String>, String> {
    let path = docs_dir(&app, &dir).join("documents.json");
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path)
        .map(Some)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn save_documents(app: AppHandle, dir: Option<String>, contents: String) -> Result<(), String> {
    write_atomic(&docs_dir(&app, &dir).join("documents.json"), &contents)
}

// ---------- backups

const SNAPSHOT_KEEP: usize = 14;

/// Daily snapshot of documents.json + retention pruning. Runs at startup
/// before the app writes anything, so it captures yesterday's state.
#[tauri::command]
fn run_backups(app: AppHandle, dir: Option<String>, retention_days: u32) -> Result<(), String> {
    let base = docs_dir(&app, &dir);
    let docs = base.join("documents.json");
    let bdir = base.join("backups");
    fs::create_dir_all(bdir.join("deleted")).map_err(|e| e.to_string())?;

    if docs.exists() {
        let name = format!("documents-{}.json", chrono::Local::now().format("%Y-%m-%d"));
        let snapshot = bdir.join(&name);
        if !snapshot.exists() {
            fs::copy(&docs, &snapshot).map_err(|e| e.to_string())?;
        }
    }

    // prune snapshots: keep the newest SNAPSHOT_KEEP by name (dates sort lexically)
    let mut snaps: Vec<PathBuf> = fs::read_dir(&bdir)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("documents-") && n.ends_with(".json"))
        })
        .collect();
    snaps.sort();
    if snaps.len() > SNAPSHOT_KEEP {
        for old in &snaps[..snaps.len() - SNAPSHOT_KEEP] {
            fs::remove_file(old).ok();
        }
    }

    // prune the deleted-sheets bin by age
    let cutoff =
        SystemTime::now() - std::time::Duration::from_secs(u64::from(retention_days) * 86400);
    if let Ok(entries) = fs::read_dir(bdir.join("deleted")) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.modified().map(|m| m < cutoff).unwrap_or(false) {
                    fs::remove_file(entry.path()).ok();
                }
            }
        }
    }
    Ok(())
}

/// A deleted sheet goes to the bin as a .numi file (restore = drag it back).
#[tauri::command]
fn backup_deleted_sheet(
    app: AppHandle,
    dir: Option<String>,
    title: String,
    contents: String,
) -> Result<(), String> {
    let bin = docs_dir(&app, &dir).join("backups").join("deleted");
    fs::create_dir_all(&bin).map_err(|e| e.to_string())?;
    let safe: String = title
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-' || *c == '_')
        .take(40)
        .collect();
    let safe = if safe.trim().is_empty() {
        "sheet".to_string()
    } else {
        safe.trim().to_string()
    };
    let name = format!(
        "{}-{}.numi",
        safe,
        chrono::Local::now().format("%Y-%m-%d-%H%M%S")
    );
    fs::write(bin.join(name), contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_backups_folder(app: AppHandle, dir: Option<String>) -> Result<(), String> {
    let bdir = docs_dir(&app, &dir).join("backups");
    fs::create_dir_all(&bdir).ok();
    app.opener()
        .open_path(bdir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

// ---------- data folder migration

#[tauri::command]
fn data_dir_has_documents(dir: String) -> bool {
    PathBuf::from(dir).join("documents.json").exists()
}

/// strategy: "move" (copy mine, delete originals), "overwrite" (same, target
/// had documents), "use_existing" (just switch — keep the target's files)
#[tauri::command]
fn migrate_data_dir(
    app: AppHandle,
    old_dir: Option<String>,
    new_dir: String,
    strategy: String,
) -> Result<(), String> {
    let old = docs_dir(&app, &old_dir);
    let new = PathBuf::from(&new_dir);
    fs::create_dir_all(&new).map_err(|e| e.to_string())?;
    // canonicalize: "C:\Data" and "c:\data" are the same folder on Windows
    let canon_old = fs::canonicalize(&old).unwrap_or_else(|_| old.clone());
    let canon_new = fs::canonicalize(&new).unwrap_or_else(|_| new.clone());
    if canon_old == canon_new {
        return Ok(());
    }
    if strategy == "use_existing" {
        return Ok(());
    }
    let old_docs = old.join("documents.json");
    if old_docs.exists() {
        fs::copy(&old_docs, new.join("documents.json")).map_err(|e| e.to_string())?;
    }
    // merge backups (skip files that already exist in the target)
    let mut all_copied = true;
    for sub in ["backups", "backups/deleted"] {
        let from = old.join(sub);
        let to = new.join(sub);
        fs::create_dir_all(&to).ok();
        if let Ok(entries) = fs::read_dir(&from) {
            for entry in entries.flatten() {
                let dest = to.join(entry.file_name());
                if entry.path().is_file() && !dest.exists() && fs::copy(entry.path(), dest).is_err()
                {
                    all_copied = false;
                }
            }
        }
    }
    // originals removed only after everything is actually copied
    if old_docs.exists() {
        fs::remove_file(&old_docs).ok();
    }
    if all_copied {
        fs::remove_dir_all(old.join("backups")).ok();
    }
    Ok(())
}

/// Used by drag&drop: read a calculation/text file from an absolute path.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let p = std::path::PathBuf::from(&path);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !["numi", "sum", "txt", "md"].contains(&ext.as_str()) {
        return Err("unsupported file type".into());
    }
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    if meta.len() > 1_000_000 {
        return Err("file too large".into());
    }
    fs::read_to_string(p).map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct ExtensionScript {
    name: String,
    code: String,
}

fn extensions_dir(app: &AppHandle) -> PathBuf {
    let dir = data_dir(app).join("extensions");
    if fs::create_dir_all(&dir).is_ok() {
        // ship Sample.js from the macOS bundle as the starter example
        let sample = dir.join("Sample.js");
        if !sample.exists() {
            fs::write(sample, SAMPLE_JS).ok();
        }
    }
    dir
}

#[tauri::command]
fn load_extensions(app: AppHandle) -> Vec<ExtensionScript> {
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(extensions_dir(&app)) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "js") {
                if let Ok(code) = fs::read_to_string(&path) {
                    out.push(ExtensionScript {
                        name: entry.file_name().to_string_lossy().into_owned(),
                        code,
                    });
                }
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

fn is_sheet_path(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".numi") || lower.ends_with(".sum")
}

/// Contents of a .numi/.sum file passed on the command line (file association).
#[tauri::command]
fn get_launch_file() -> Option<String> {
    let arg = std::env::args().nth(1)?;
    if is_sheet_path(&arg) {
        fs::read_to_string(arg).ok()
    } else {
        None
    }
}

#[tauri::command]
fn open_extensions_folder(app: AppHandle) -> Result<(), String> {
    let dir = extensions_dir(&app);
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Called by the frontend after it has flushed unsaved edits on "app-quit".
#[tauri::command]
fn exit_app(app: AppHandle) {
    app.exit(0);
}

/// True when the app was launched by autostart (passes --hidden arg).
/// The frontend uses this to stay in the tray instead of showing the window.
#[tauri::command]
fn is_hidden_launch() -> bool {
    std::env::args().any(|a| a == "--hidden")
}

/// Quit via the frontend so the debounced autosave gets flushed first;
/// a watchdog exits anyway in case the webview is unresponsive.
fn request_quit(app: &AppHandle) {
    if app.emit("app-quit", ()).is_err() {
        app.exit(0);
        return;
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(2000));
        handle.exit(0);
    });
}

fn toggle_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let visible = win.is_visible().unwrap_or(false);
        if visible && win.is_focused().unwrap_or(false) {
            win.hide().ok();
        } else {
            win.show().ok();
            win.set_focus().ok();
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(path) = args.iter().skip(1).find(|a| is_sheet_path(a)) {
                if let Ok(content) = fs::read_to_string(path) {
                    app.emit("open-file", content).ok();
                }
            }
            if let Some(win) = app.get_webview_window("main") {
                win.show().ok();
                win.set_focus().ok();
            }
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            save_file,
            load_file,
            load_documents,
            save_documents,
            run_backups,
            backup_deleted_sheet,
            open_backups_folder,
            data_dir_has_documents,
            migrate_data_dir,
            fetch_rates,
            load_extensions,
            open_extensions_folder,
            get_launch_file,
            read_text_file,
            exit_app,
            is_hidden_launch
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let show = MenuItem::with_id(app, "show", "Show / Hide", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Summarum", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::with_id("tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Summarum")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => toggle_window(app),
                    "quit" => request_quit(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_window(tray.app_handle());
                    }
                })
                .build(app)?;
            let _ = handle;
            Ok(())
        })
        .on_window_event(|window, event| {
            // close hides to tray
            if let WindowEvent::CloseRequested { api, .. } = event {
                window.hide().ok();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Summarum");
}

#[cfg(test)]
mod tests {
    use super::*;

    // safe_name
    #[test]
    fn safe_name_rejects_empty() {
        assert!(!safe_name(""));
    }
    #[test]
    fn safe_name_rejects_slashes() {
        assert!(!safe_name("foo/bar"));
        assert!(!safe_name("foo\\bar"));
    }
    #[test]
    fn safe_name_rejects_colon() {
        assert!(!safe_name("C:file"));
    }
    #[test]
    fn safe_name_rejects_dotdot() {
        assert!(!safe_name("../secret"));
        assert!(!safe_name(".."));
    }
    #[test]
    fn safe_name_accepts_valid() {
        assert!(safe_name("settings.json"));
        assert!(safe_name("documents.json"));
        assert!(safe_name("rates.json"));
    }

    // is_sheet_path
    #[test]
    fn is_sheet_path_matches_extensions() {
        assert!(is_sheet_path("my-calc.numi"));
        assert!(is_sheet_path("budget.sum"));
        assert!(is_sheet_path("MY-CALC.NUMI"));
        assert!(is_sheet_path("BUDGET.SUM"));
    }
    #[test]
    fn is_sheet_path_rejects_others() {
        assert!(!is_sheet_path("notes.txt"));
        assert!(!is_sheet_path("doc.md"));
        assert!(!is_sheet_path("script.js"));
        assert!(!is_sheet_path("numi"));
        assert!(!is_sheet_path(""));
    }
}
