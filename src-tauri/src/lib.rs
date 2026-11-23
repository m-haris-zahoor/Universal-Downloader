mod analyze;
mod bins;
mod db;
mod queue;

use queue::{AppState, DownloadReq};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

type R<T> = Result<T, String>;

#[tauri::command]
async fn analyze(app: AppHandle, url: String) -> R<analyze::MediaInfo> {
    analyze::analyze(&app, &url).await
}

#[tauri::command]
fn enqueue(app: AppHandle, req: DownloadReq) -> R<String> {
    queue::enqueue(&app, req)
}

#[tauri::command]
fn list_jobs(st: State<AppState>) -> Vec<queue::Job> {
    st.jobs.lock().unwrap().clone()
}

#[tauri::command]
fn job_control(app: AppHandle, id: String, action: String) -> R<()> {
    queue::control(&app, &id, &action)
}

#[tauri::command]
fn remove_jobs(app: AppHandle, id: Option<String>) {
    queue::remove(&app, id.as_deref());
}

#[tauri::command]
fn get_settings(st: State<AppState>) -> db::Settings {
    st.settings.lock().unwrap().clone()
}

#[tauri::command]
fn save_settings(app: AppHandle, st: State<AppState>, mut settings: db::Settings) -> R<db::Settings> {
    settings.max_concurrent = settings.max_concurrent.clamp(1, 10);
    if settings.download_dir.trim().is_empty() || !std::path::Path::new(&settings.download_dir).is_absolute() {
        return Err("Download location must be an absolute path.".into());
    }
    std::fs::create_dir_all(&settings.download_dir).map_err(|e| format!("Cannot use that folder: {e}"))?;
    db::save_settings(&st.db.lock().unwrap(), &settings).map_err(|e| e.to_string())?;
    *st.settings.lock().unwrap() = settings.clone();
    queue::pump(&app);
    Ok(settings)
}

#[tauri::command]
fn get_history(st: State<AppState>) -> R<Vec<db::HistoryItem>> {
    db::list_history(&st.db.lock().unwrap()).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_history(st: State<AppState>, id: String) -> R<()> {
    db::delete_history(&st.db.lock().unwrap(), &id).map_err(|e| e.to_string())
}

/// Only paths recorded in history may be opened.
fn known_path(st: &AppState, path: &str) -> R<()> {
    let ok = db::list_history(&st.db.lock().unwrap()).map_err(|e| e.to_string())?.iter().any(|h| h.file_path == path);
    if ok { Ok(()) } else { Err("Unknown file.".into()) }
}

#[tauri::command]
fn open_file(app: AppHandle, st: State<AppState>, path: String) -> R<()> {
    known_path(&st, &path)?;
    if !std::path::Path::new(&path).exists() { return Err("File no longer exists.".into()); }
    app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn reveal_file(app: AppHandle, st: State<AppState>, path: String) -> R<()> {
    known_path(&st, &path)?;
    app.opener().reveal_item_in_dir(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_download_dir(app: AppHandle, st: State<AppState>) -> R<()> {
    let d = st.settings.lock().unwrap().download_dir.clone();
    let _ = std::fs::create_dir_all(&d);
    app.opener().open_path(d, None::<&str>).map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct Tools { ytdlp: bins::ToolInfo, ffmpeg: bins::ToolInfo, ffprobe: bins::ToolInfo }

#[tauri::command]
async fn tool_status(app: AppHandle) -> Tools {
    Tools {
        ytdlp: bins::tool_info(&app, "yt-dlp").await,
        ffmpeg: bins::tool_info(&app, "ffmpeg").await,
        ffprobe: bins::tool_info(&app, "ffprobe").await,
    }
}

fn dir_size(p: &std::path::Path) -> u64 {
    std::fs::read_dir(p).map(|rd| rd.flatten().map(|e| {
        let m = e.metadata();
        match m { Ok(m) if m.is_dir() => dir_size(&e.path()), Ok(m) => m.len(), _ => 0 }
    }).sum()).unwrap_or(0)
}

#[tauri::command]
fn clear_cache(st: State<AppState>) -> R<u64> {
    let active = st.jobs.lock().unwrap().iter().any(|j| matches!(j.status, queue::Status::Downloading | queue::Status::Processing | queue::Status::Paused | queue::Status::Queued));
    if active { return Err("Finish or cancel active downloads before clearing the cache.".into()); }
    let tmp = st.cache_dir.join("tmp");
    let n = dir_size(&tmp);
    let _ = std::fs::remove_dir_all(&tmp);
    Ok(n)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            let conn = db::open(&data.join("downloader.sqlite3"))?;
            let mut settings = db::load_settings(&conn);
            if settings.download_dir.is_empty() {
                let base = app.path().download_dir().unwrap_or_else(|_| data.clone());
                settings.download_dir = base.join("Universal Downloader").display().to_string();
                db::save_settings(&conn, &settings)?;
            }
            app.manage(AppState {
                db: Mutex::new(conn),
                settings: Mutex::new(settings),
                jobs: Mutex::new(vec![]),
                cache_dir: app.path().app_cache_dir()?,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            analyze, enqueue, list_jobs, job_control, remove_jobs, get_settings, save_settings,
            get_history, delete_history, open_file, reveal_file, open_download_dir, tool_status, clear_cache
        ])
        .run(tauri::generate_context!())
        .expect("error while running application");
}
