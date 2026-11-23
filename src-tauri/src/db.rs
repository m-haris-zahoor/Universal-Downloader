use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub download_dir: String,
    pub video_quality: String, // "best" or height e.g. "1080"
    pub audio_quality: String, // "best" or kbps e.g. "192"
    pub video_format: String,
    pub audio_format: String,
    pub max_concurrent: usize,
    pub clipboard_detect: bool,
    pub theme: String,
    pub prefer_hq: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            download_dir: String::new(),
            video_quality: "best".into(),
            audio_quality: "best".into(),
            video_format: "mp4".into(),
            audio_format: "mp3".into(),
            max_concurrent: 3,
            clipboard_detect: true,
            theme: "dark".into(),
            prefer_hq: true,
        }
    }
}

#[derive(Clone, Serialize)]
pub struct HistoryItem {
    pub id: String,
    pub title: String,
    pub thumbnail: Option<String>,
    pub url: String,
    pub platform: String,
    pub file_path: String,
    pub kind: String,
    pub resolution: String,
    pub format: String,
    pub size: u64,
    pub created_at: i64,
    pub exists: bool,
}

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let c = Connection::open(path)?;
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS history (
            id TEXT PRIMARY KEY, title TEXT, thumbnail TEXT, url TEXT, platform TEXT,
            file_path TEXT, kind TEXT, resolution TEXT, format TEXT, size INTEGER, created_at INTEGER);",
    )?;
    Ok(c)
}

pub fn load_settings(c: &Connection) -> Settings {
    c.query_row("SELECT value FROM settings WHERE key='app'", [], |r| r.get::<_, String>(0))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_settings(c: &Connection, s: &Settings) -> rusqlite::Result<()> {
    c.execute(
        "INSERT INTO settings(key,value) VALUES('app',?1) ON CONFLICT(key) DO UPDATE SET value=?1",
        params![serde_json::to_string(s).unwrap()],
    )?;
    Ok(())
}

pub fn add_history(c: &Connection, h: &HistoryItem) -> rusqlite::Result<()> {
    c.execute(
        "INSERT OR REPLACE INTO history VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        params![h.id, h.title, h.thumbnail, h.url, h.platform, h.file_path, h.kind, h.resolution, h.format, h.size as i64, h.created_at],
    )?;
    Ok(())
}

pub fn list_history(c: &Connection) -> rusqlite::Result<Vec<HistoryItem>> {
    let mut st = c.prepare(
        "SELECT id,title,thumbnail,url,platform,file_path,kind,resolution,format,size,created_at FROM history ORDER BY created_at DESC",
    )?;
    let rows = st.query_map([], |r| {
        let fp: String = r.get(5)?;
        Ok(HistoryItem {
            id: r.get(0)?, title: r.get(1)?, thumbnail: r.get(2)?, url: r.get(3)?, platform: r.get(4)?,
            exists: Path::new(&fp).exists(), file_path: fp, kind: r.get(6)?, resolution: r.get(7)?,
            format: r.get(8)?, size: r.get::<_, i64>(9)? as u64, created_at: r.get(10)?,
        })
    })?;
    rows.collect()
}

pub fn delete_history(c: &Connection, id: &str) -> rusqlite::Result<()> {
    c.execute("DELETE FROM history WHERE id=?1", params![id])?;
    Ok(())
}
