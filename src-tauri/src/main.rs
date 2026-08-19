// Summarum — Tauri shell: tray, hide-to-tray window, app-data storage,
// currency rates fetching with an on-disk cache, extension script loading.
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, WindowEvent};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const RATES_TTL_SECS: u64 = 3600;
const SAMPLE_JS: &str = include_str!("../extension-sample.js");
/// Rust owns this file: it records the data folder the user committed to via
/// the native picker. `save_file`/`load_file` refuse the name so the frontend
/// cannot forge its own authorization.
const DATA_DIR_FILE: &str = "data-dir.txt";
const MAX_SHEET_BYTES: u64 = 1_000_000;

fn data_dir(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().expect("no app data dir");
    fs::create_dir_all(&dir).ok();
    dir
}

/// Which folder the frontend may point file operations at.
///
/// Every `dir` argument arrives over IPC, where a buggy extension or
/// compromised webview content can name any path on disk, so a path counts
/// only when the user proved intent for it: `picked` is the folder just chosen
/// in the native picker, `active` is the folder in use — plus the one being
/// migrated away from, so a migration that fails partway leaves the folder the
/// frontend is still pointing at usable.
#[derive(Default)]
struct DataDirGate {
    picked: Mutex<Option<PathBuf>>,
    active: Mutex<Vec<PathBuf>>,
}

fn canon_or_raw(p: &Path) -> PathBuf {
    fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

/// Exact match against an authorized folder, compared canonicalized so a
/// symlink or ".." spelling cannot stand in for a different path. A subfolder
/// of an authorized folder is not itself authorized.
fn path_allowed(candidate: &Path, allowed: &[PathBuf]) -> bool {
    let c = canon_or_raw(candidate);
    allowed.iter().any(|a| canon_or_raw(a) == c)
}

/// The custom folder recorded in the app's own settings.json, if any. Only
/// read once, to seed the gate on the first run after it was introduced —
/// settings.json is frontend-writable and is not a trust anchor afterwards.
fn settings_data_dir(app: &AppHandle) -> Option<PathBuf> {
    let raw = fs::read_to_string(data_dir(app).join("settings.json")).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let d = parsed.get("dataDir")?.as_str()?.trim();
    (!d.is_empty()).then(|| PathBuf::from(d))
}

fn seed_data_dir_gate(app: &AppHandle) {
    let marker = data_dir(app).join(DATA_DIR_FILE);
    let active = match fs::read_to_string(&marker) {
        Ok(raw) => {
            let t = raw.trim();
            (!t.is_empty()).then(|| PathBuf::from(t))
        }
        Err(_) => {
            // upgrading over an install that predates the gate: adopt the
            // folder already configured, then stop consulting settings.json
            let adopted = settings_data_dir(app);
            let contents = adopted
                .as_ref()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            write_atomic(&marker, &contents).ok();
            adopted
        }
    };
    *app.state::<DataDirGate>().active.lock().unwrap() = active.into_iter().collect();
}

/// Let the session use `dir` without yet declaring it the folder to come back
/// to on the next launch — the previous folder stays usable meanwhile.
fn authorize_data_dir(app: &AppHandle, dir: &Path) {
    let gate = app.state::<DataDirGate>();
    let mut active = gate.active.lock().unwrap();
    active.retain(|p| p != dir);
    active.insert(0, dir.to_path_buf());
    active.truncate(2);
}

/// Record the folder the migration actually landed in. Only reached once every
/// file is in place, so a half-finished migration never becomes the folder the
/// app boots into.
fn commit_data_dir(app: &AppHandle, dir: &Path) -> Result<(), String> {
    write_atomic(
        &data_dir(app).join(DATA_DIR_FILE),
        dir.to_string_lossy().as_ref(),
    )?;
    authorize_data_dir(app, dir);
    Ok(())
}

/// Documents live either in the default app-data dir or in a user-chosen
/// folder (settings stay in app-data — the path itself is stored there).
/// Anything other than the default has to clear `DataDirGate` first.
fn docs_dir(app: &AppHandle, dir: &Option<String>) -> Result<PathBuf, String> {
    let requested = dir.as_deref().map(str::trim).unwrap_or("");
    if requested.is_empty() {
        return Ok(data_dir(app));
    }
    let candidate = PathBuf::from(requested);
    let gate = app.state::<DataDirGate>();
    let allowed: Vec<PathBuf> = {
        let mut allowed = gate.active.lock().unwrap().clone();
        allowed.extend(gate.picked.lock().unwrap().clone());
        allowed
    };
    if !path_allowed(&candidate, &allowed) {
        return Err("data folder was not chosen by the user".into());
    }
    fs::create_dir_all(&candidate).ok();
    Ok(candidate)
}

fn safe_name(name: &str) -> bool {
    let path = Path::new(name);
    let mut components = path.components();
    match components.next() {
        Some(std::path::Component::Normal(_)) if components.next().is_none() => {
            !name.contains(['/', '\\', ':'])
        }
        _ => false,
    }
}

#[tauri::command]
fn write_text_file(app: AppHandle, contents: String, is_sum: bool) -> Result<bool, String> {
    let (name, ext) = if is_sum {
        ("Summarum Sheet", "sum")
    } else {
        ("Text file", "txt")
    };
    if let Some(p) = app
        .dialog()
        .file()
        .add_filter(name, &[ext])
        .blocking_save_file()
    {
        write_atomic(&p.into_path().map_err(|e| e.to_string())?, &contents)?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
fn write_image_file(app: AppHandle, data_base64: String) -> Result<bool, String> {
    if let Some(p) = app
        .dialog()
        .file()
        .add_filter("PNG Image", &["png"])
        .blocking_save_file()
    {
        let path = p.into_path().map_err(|e| e.to_string())?;
        write_atomic_bytes(&path, &base64_decode(&data_base64)?)?;
        Ok(true)
    } else {
        Ok(false)
    }
}

fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
    use std::collections::HashMap;
    let alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut map = HashMap::new();
    for (i, c) in alphabet.chars().enumerate() {
        map.insert(c, i as u8);
    }
    let s: String = s.chars().filter(|c| *c != '=').collect();
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let bytes: Vec<u8> = s
        .chars()
        .map(|c| {
            map.get(&c)
                .copied()
                .ok_or_else(|| format!("bad base64 char {}", c))
        })
        .collect::<Result<_, _>>()?;
    for chunk in bytes.chunks(4) {
        if chunk.len() < 2 {
            return Err("invalid base64 padding".into());
        }
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        let b3 = *chunk.get(3).unwrap_or(&0);
        out.push((b0 << 2) | (b1 >> 4));
        if chunk.len() > 2 {
            out.push((b1 << 4) | (b2 >> 2));
        }
        if chunk.len() > 3 {
            out.push((b2 << 6) | b3);
        }
    }
    Ok(out)
}

static TMP_COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// write via a temp file + rename so a crash mid-write cannot corrupt the target
fn write_atomic_bytes(path: &Path, contents: &[u8]) -> Result<(), String> {
    let count = TMP_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp = path.with_extension(format!("tmp.{}", count));
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    write_atomic_bytes(path, contents.as_bytes())
}

async fn read_file_async(path: PathBuf) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || fs::read_to_string(path).ok())
        .await
        .ok()
        .flatten()
}

async fn write_atomic_async(path: PathBuf, contents: String) {
    let _ = tauri::async_runtime::spawn_blocking(move || write_atomic(&path, &contents)).await;
}

/// settings.json and friends; DATA_DIR_FILE is Rust's own authorization record
/// and must not be forgeable from the frontend.
fn writable_name(name: &str) -> bool {
    safe_name(name) && !name.eq_ignore_ascii_case(DATA_DIR_FILE)
}

#[tauri::command]
fn save_file(app: AppHandle, name: String, contents: String) -> Result<(), String> {
    if !writable_name(&name) {
        return Err("bad file name".into());
    }
    write_atomic(&data_dir(&app).join(name), &contents)
}

#[tauri::command]
fn load_file(app: AppHandle, name: String) -> Result<Option<String>, String> {
    if !writable_name(&name) {
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

async fn read_rates_cache(app: &AppHandle) -> Option<RatesCache> {
    let raw = read_file_async(data_dir(app).join("rates.json")).await?;
    serde_json::from_str(&raw).ok()
}

const RATES_RESPONSE_LIMIT: usize = 5 * 1024 * 1024;

/// Reads the body as a stream and aborts as soon as it exceeds `limit`,
/// instead of buffering an unbounded body in memory before checking its size.
async fn read_body_capped(resp: reqwest::Response, limit: usize) -> Result<Vec<u8>, String> {
    use futures::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut buf = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        buf.extend_from_slice(&chunk);
        if buf.len() > limit {
            return Err("response too large".into());
        }
    }
    Ok(buf)
}

async fn fetch_rates_online() -> Result<RatesPayload, String> {
    let client = HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap_or_default()
    });

    let resp = client
        .get("https://open.er-api.com/v6/latest/USD")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let bytes = read_body_capped(resp, RATES_RESPONSE_LIMIT).await?;
    let body: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;

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
        if let Ok(bytes) = read_body_capped(resp, RATES_RESPONSE_LIMIT).await {
            if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                for (code, id) in CRYPTO {
                    if let Some(price) = json[id]["usd"].as_f64() {
                        if price > 0.0 {
                            rates.insert((*code).into(), serde_json::json!(1.0 / price));
                        }
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
        if let Some(cache) = read_rates_cache(&app).await {
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
                write_atomic_async(data_dir(&app).join("rates.json"), raw).await;
            }
            Ok(payload)
        }
        Err(e) => read_rates_cache(&app)
            .await
            .map(|c| {
                let mut payload = c.payload;
                payload.fetched_at = c.fetched_at;
                payload
            })
            .ok_or(e),
    }
}

// ---------- market data (stocks, commodities via Yahoo Finance)

const MARKET_TTL_SECS: u64 = 900; // 15 minutes

#[derive(Serialize, Deserialize, Clone)]
struct MarketCache {
    fetched_at: u64,
    prices: std::collections::HashMap<String, f64>,
}

#[tauri::command]
async fn fetch_market_data(
    app: AppHandle,
    symbols: Vec<String>,
) -> Result<std::collections::HashMap<String, f64>, String> {
    let cache_path = data_dir(&app).join("market.json");

    // try cache first
    if let Some(raw) = read_file_async(cache_path.clone()).await {
        if let Ok(cache) = serde_json::from_str::<MarketCache>(&raw) {
            if now_secs().saturating_sub(cache.fetched_at) < MARKET_TTL_SECS {
                let syms: std::collections::HashSet<&str> =
                    symbols.iter().map(|s| s.as_str()).collect();
                let hit: std::collections::HashMap<String, f64> = cache
                    .prices
                    .into_iter()
                    .filter(|(k, _)| syms.contains(k.as_str()))
                    .collect();
                if !hit.is_empty() {
                    return Ok(hit);
                }
            }
        }
    }

    if symbols.is_empty() {
        return Ok(std::collections::HashMap::new());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("Mozilla/5.0")
        .build()
        .map_err(|e| e.to_string())?;

    // v7/finance/quote now requires a cookie+crumb pair Yahoo stopped issuing
    // to plain API clients (returns 401); v8 chart still answers anonymously,
    // one symbol per request.
    let futures_reqs = symbols.iter().map(|sym| {
        let client = client.clone();
        async move {
            let url = format!(
                "https://query1.finance.yahoo.com/v8/finance/chart/{}?range=1d&interval=1d",
                sym
            );
            if let Ok(resp) = client.get(&url).send().await {
                if let Ok(body) = resp.json::<serde_json::Value>().await {
                    if let Some(price) =
                        body["chart"]["result"][0]["meta"]["regularMarketPrice"].as_f64()
                    {
                        if price > 0.0 {
                            return Some((sym.clone(), price));
                        }
                    }
                }
            }
            None
        }
    });

    let mut prices = std::collections::HashMap::new();
    let results = futures::future::join_all(futures_reqs).await;
    for (sym, price) in results.into_iter().flatten() {
        prices.insert(sym, price);
    }

    if !prices.is_empty() {
        let cache = MarketCache {
            fetched_at: now_secs(),
            prices: prices.clone(),
        };
        if let Ok(raw) = serde_json::to_string(&cache) {
            write_atomic_async(cache_path, raw).await;
        }
    }

    Ok(prices)
}

// ---------- historical rates (frankfurter.app, cached permanently per date)

fn valid_date_str(date: &str) -> bool {
    let parts: Vec<&str> = date.split('-').collect();
    parts.len() == 3
        && parts[0].len() == 4
        && parts[1].len() == 2
        && parts[2].len() == 2
        && parts.iter().all(|p| p.chars().all(|c| c.is_ascii_digit()))
}

static HTTP_CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();

/// frankfurter quotes everything against the `from=USD` base, so USD itself is
/// never in the response and has to be anchored by hand.
fn parse_rate_map(
    raw_rates: &serde_json::Map<String, serde_json::Value>,
) -> std::collections::HashMap<String, f64> {
    let mut rates = std::collections::HashMap::new();
    rates.insert("USD".to_string(), 1.0_f64);
    for (code, val) in raw_rates {
        if let Some(v) = val.as_f64() {
            if v > 0.0 {
                rates.insert(code.to_uppercase(), v);
            }
        }
    }
    rates
}

#[tauri::command]
async fn fetch_historical_rates(
    app: AppHandle,
    date: String,
) -> Result<std::collections::HashMap<String, f64>, String> {
    if !valid_date_str(&date) {
        return Err("invalid date format".into());
    }
    let cache_path = data_dir(&app).join(format!("rates-{}.json", date));
    if let Some(raw) = read_file_async(cache_path.clone()).await {
        if let Ok(cached) = serde_json::from_str::<std::collections::HashMap<String, f64>>(&raw) {
            return Ok(cached);
        }
    }
    let client = HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap_or_default()
    });
    // api.frankfurter.app 301-redirects here now, and the old domain is
    // flaky over reqwest/rustls-tls — go straight to the stable host
    let url = format!("https://api.frankfurter.dev/v1/{}?from=USD", date);
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;

    let bytes = read_body_capped(resp, RATES_RESPONSE_LIMIT).await?;
    let body: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let rates = parse_rate_map(body["rates"].as_object().ok_or("no rates in response")?);
    if let Ok(serialized) = serde_json::to_string(&rates) {
        write_atomic_async(cache_path, serialized).await;
    }
    Ok(rates)
}

#[tauri::command]
async fn fetch_historical_rates_batch(
    app: AppHandle,
    dates: Vec<String>,
) -> Result<std::collections::HashMap<String, std::collections::HashMap<String, f64>>, String> {
    let mut results = std::collections::HashMap::new();
    let mut missing_dates = Vec::new();

    for date in &dates {
        if !valid_date_str(date) {
            continue;
        }
        let cache_path = data_dir(&app).join(format!("rates-{}.json", date));
        if let Some(raw) = read_file_async(cache_path).await {
            if let Ok(cached) = serde_json::from_str::<std::collections::HashMap<String, f64>>(&raw)
            {
                results.insert(date.clone(), cached);
                continue;
            }
        }
        missing_dates.push(date.clone());
    }

    if missing_dates.is_empty() {
        return Ok(results);
    }

    let client = HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap_or_default()
    });

    let mut futures = Vec::new();

    for date in missing_dates {
        let url = format!("https://api.frankfurter.dev/v1/{}?from=USD", date);
        let client_clone = client.clone();
        let app_clone = app.clone();

        futures.push(async move {
            let mut rate_map = None;
            if let Ok(resp) = client_clone.get(&url).send().await {
                if let Ok(bytes) = read_body_capped(resp, RATES_RESPONSE_LIMIT).await {
                    if let Ok(body) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                        if let Some(rates_obj) = body["rates"].as_object() {
                            let daily_rates = parse_rate_map(rates_obj);
                            let cache_path =
                                data_dir(&app_clone).join(format!("rates-{}.json", date));
                            if let Ok(serialized) = serde_json::to_string(&daily_rates) {
                                write_atomic_async(cache_path, serialized).await;
                            }
                            rate_map = Some((date, daily_rates));
                        }
                    }
                }
            }
            rate_map
        });
    }

    use futures::stream::StreamExt;
    let fetched_results = futures::stream::iter(futures)
        .buffer_unordered(5)
        .collect::<Vec<_>>()
        .await;

    for (date, rates) in fetched_results.into_iter().flatten() {
        results.insert(date, rates);
    }

    Ok(results)
}

// ---------- documents in the (possibly custom) data folder

#[tauri::command]
fn load_documents(app: AppHandle, dir: Option<String>) -> Result<Option<String>, String> {
    let path = docs_dir(&app, &dir)?.join("documents.json");
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path)
        .map(Some)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn save_documents(app: AppHandle, dir: Option<String>, contents: String) -> Result<(), String> {
    write_atomic(&docs_dir(&app, &dir)?.join("documents.json"), &contents)
}

// ---------- backups

const SNAPSHOT_KEEP: usize = 14;

/// Daily snapshot of documents.json + retention pruning. Runs at startup
/// before the app writes anything, so it captures yesterday's state.
#[tauri::command]
fn run_backups(app: AppHandle, dir: Option<String>, retention_days: u32) -> Result<(), String> {
    let base = docs_dir(&app, &dir)?;
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
    let bin = docs_dir(&app, &dir)?.join("backups").join("deleted");
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
    write_atomic(&bin.join(name), &contents)
}

#[tauri::command]
fn open_backups_folder(app: AppHandle, dir: Option<String>) -> Result<(), String> {
    let bdir = docs_dir(&app, &dir)?.join("backups");
    fs::create_dir_all(&bdir).ok();
    app.opener()
        .open_path(bdir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

// ---------- data folder migration

/// Gated like every other `dir` argument: without it this is a probe for the
/// existence of an arbitrary path anywhere on disk.
#[tauri::command]
fn data_dir_has_documents(app: AppHandle, dir: String) -> Result<bool, String> {
    Ok(docs_dir(&app, &Some(dir))?.join("documents.json").exists())
}

#[tauri::command]
fn pick_data_dir(app: AppHandle) -> Result<Option<String>, String> {
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let canon = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    *app.state::<DataDirGate>().picked.lock().unwrap() = Some(canon);
    Ok(Some(path.to_string_lossy().into_owned()))
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
    // `old_dir` is exactly as untrusted as `new_dir`: on "move" this function
    // deletes documents.json and every file under backups/ beneath it, so it
    // has to clear the gate before anything else happens.
    let old = docs_dir(&app, &old_dir)?;
    let new = PathBuf::from(&new_dir);
    // canonicalize: "C:\Data" and "c:\data" are the same folder on Windows
    let canon_new = fs::canonicalize(&new).map_err(|e| e.to_string())?;
    let gate = app.state::<DataDirGate>();
    {
        let picked = gate.picked.lock().unwrap();
        if picked.as_deref() != Some(canon_new.as_path()) {
            return Err("target folder was not chosen by the user".into());
        }
    }
    let canon_old = fs::canonicalize(&old).unwrap_or_else(|_| old.clone());
    if canon_old == canon_new || strategy == "use_existing" {
        gate.picked.lock().unwrap().take();
        return commit_data_dir(&app, &canon_new);
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
    gate.picked.lock().unwrap().take();
    // originals removed only after everything is actually copied
    if old_docs.exists() {
        fs::remove_file(&old_docs).ok();
    }
    // one level at a time, files only — a recursive delete of anything named
    // "backups" is too big a hammer even for a gated path.
    // run_backups/backup_deleted_sheet only ever write flat files here.
    if all_copied {
        for sub in ["backups", "backups/deleted"] {
            if let Ok(entries) = fs::read_dir(old.join(sub)) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_file() {
                        fs::remove_file(&p).ok();
                    }
                }
            }
        }
    }
    commit_data_dir(&app, &canon_new)
}

/// Paths the OS actually handed us in a window drop event. The frontend can
/// name any path over IPC, so this is the only proof a read was user-initiated.
#[derive(Default)]
struct DroppedFiles(Mutex<HashSet<PathBuf>>);

/// Used by drag&drop: read a calculation/text file dropped onto the window.
#[tauri::command]
fn read_text_file(app: AppHandle, path: String) -> Result<String, String> {
    // compare canonicalized, so a symlink or ".." spelling of an allowed path
    // cannot stand in for a different file
    let p = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    if !app.state::<DroppedFiles>().0.lock().unwrap().contains(&p) {
        return Err("file was not dropped onto the window".into());
    }
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !["numi", "sum", "txt", "md"].contains(&ext.as_str()) {
        return Err("unsupported file type".into());
    }
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    if meta.len() > MAX_SHEET_BYTES {
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

/// A sheet handed to us by the OS (file association, second launch): same
/// extension whitelist and size cap `read_text_file` applies to drag&drop.
fn read_sheet_file(path: &Path) -> Option<String> {
    if !is_sheet_path(&path.to_string_lossy()) {
        return None;
    }
    if fs::metadata(path).ok()?.len() > MAX_SHEET_BYTES {
        return None;
    }
    fs::read_to_string(path).ok()
}

/// Contents of a .numi/.sum file passed on the command line (file association).
#[tauri::command]
fn get_launch_file() -> Option<String> {
    read_sheet_file(Path::new(&std::env::args().nth(1)?))
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
                if let Some(content) = read_sheet_file(Path::new(path)) {
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(DroppedFiles::default())
        .manage(DataDirGate::default())
        .invoke_handler(tauri::generate_handler![
            save_file,
            load_file,
            load_documents,
            save_documents,
            run_backups,
            backup_deleted_sheet,
            open_backups_folder,
            data_dir_has_documents,
            pick_data_dir,
            migrate_data_dir,
            fetch_rates,
            fetch_historical_rates,
            fetch_historical_rates_batch,
            fetch_market_data,
            load_extensions,
            open_extensions_folder,
            get_launch_file,
            read_text_file,
            exit_app,
            is_hidden_launch,
            write_text_file,
            write_image_file
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            // before the webview can ask for anything, so a frontend-written
            // settings.json cannot influence an already-seeded gate
            seed_data_dir_gate(&handle);
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
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // close hides to tray
            WindowEvent::CloseRequested { api, .. } => {
                window.hide().ok();
                api.prevent_close();
            }
            // runs before the webview gets tauri://drag-drop (that emit only
            // queues a script eval), so the paths are allowed by the time the
            // frontend can ask for them
            WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) => {
                let allowed: HashSet<PathBuf> = paths
                    .iter()
                    .filter_map(|p| fs::canonicalize(p).ok())
                    .collect();
                *window.state::<DroppedFiles>().0.lock().unwrap() = allowed;
            }
            _ => {}
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

    // writable_name — the frontend must not be able to forge the gate's record
    #[test]
    fn writable_name_rejects_the_data_dir_marker() {
        assert!(!writable_name(DATA_DIR_FILE));
        assert!(!writable_name("DATA-DIR.TXT"));
    }
    #[test]
    fn writable_name_accepts_ordinary_app_files() {
        assert!(writable_name("settings.json"));
        assert!(writable_name("documents.json"));
    }

    fn temp_subdir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("summarum-test-{}-{}", tag, nanos));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    // path_allowed — the IPC trust boundary for data-folder paths
    #[test]
    fn path_allowed_rejects_when_nothing_is_authorized() {
        let dir = temp_subdir("gate-empty");
        assert!(!path_allowed(&dir, &[]));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn path_allowed_accepts_the_authorized_dir() {
        let dir = temp_subdir("gate-ok");
        assert!(path_allowed(&dir, std::slice::from_ref(&dir)));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn path_allowed_accepts_a_different_spelling_of_the_same_dir() {
        let dir = temp_subdir("gate-spelling");
        fs::create_dir_all(dir.join("sub")).unwrap();
        let detour = dir.join("sub").join("..");
        assert!(path_allowed(&detour, std::slice::from_ref(&dir)));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn path_allowed_rejects_an_unrelated_dir() {
        let allowed = temp_subdir("gate-allowed");
        let attacker = temp_subdir("gate-attacker");
        assert!(!path_allowed(&attacker, std::slice::from_ref(&allowed)));
        fs::remove_dir_all(&allowed).ok();
        fs::remove_dir_all(&attacker).ok();
    }

    #[test]
    fn path_allowed_rejects_a_subdir_of_an_authorized_dir() {
        let allowed = temp_subdir("gate-parent");
        let child = allowed.join("child");
        fs::create_dir_all(&child).unwrap();
        assert!(!path_allowed(&child, std::slice::from_ref(&allowed)));
        fs::remove_dir_all(&allowed).ok();
    }

    #[test]
    fn path_allowed_rejects_a_missing_dir_that_is_not_authorized() {
        let allowed = temp_subdir("gate-missing");
        let ghost = allowed
            .parent()
            .unwrap()
            .join("summarum-test-ghost-does-not-exist");
        assert!(!path_allowed(&ghost, std::slice::from_ref(&allowed)));
        fs::remove_dir_all(&allowed).ok();
    }

    // parse_rate_map
    #[test]
    fn parse_rate_map_always_anchors_usd() {
        let obj = serde_json::json!({});
        let map = parse_rate_map(obj.as_object().unwrap());
        assert_eq!(map.get("USD"), Some(&1.0));
    }

    #[test]
    fn parse_rate_map_uppercases_codes() {
        let obj = serde_json::json!({ "eur": 0.9, "Gbp": 0.8 });
        let map = parse_rate_map(obj.as_object().unwrap());
        assert_eq!(map.get("EUR"), Some(&0.9));
        assert_eq!(map.get("GBP"), Some(&0.8));
    }

    #[test]
    fn parse_rate_map_skips_nonpositive_and_nonnumeric() {
        let obj =
            serde_json::json!({ "EUR": 0.9, "AAA": 0.0, "BBB": -1.5, "CCC": "oops", "DDD": null });
        let map = parse_rate_map(obj.as_object().unwrap());
        assert_eq!(map.get("EUR"), Some(&0.9));
        assert!(!map.contains_key("AAA"));
        assert!(!map.contains_key("BBB"));
        assert!(!map.contains_key("CCC"));
        assert!(!map.contains_key("DDD"));
    }

    // read_sheet_file — size cap shared with read_text_file
    #[test]
    fn read_sheet_file_reads_a_small_sheet() {
        let dir = temp_subdir("sheet-small");
        let path = dir.join("calc.numi");
        fs::write(&path, "2 + 2").unwrap();
        assert_eq!(read_sheet_file(&path).as_deref(), Some("2 + 2"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_sheet_file_rejects_an_oversized_sheet() {
        let dir = temp_subdir("sheet-big");
        let path = dir.join("calc.numi");
        fs::write(&path, "x".repeat((MAX_SHEET_BYTES + 1) as usize)).unwrap();
        assert!(read_sheet_file(&path).is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_sheet_file_rejects_a_foreign_extension() {
        let dir = temp_subdir("sheet-ext");
        let path = dir.join("payload.js");
        fs::write(&path, "alert(1)").unwrap();
        assert!(read_sheet_file(&path).is_none());
        fs::remove_dir_all(&dir).ok();
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
