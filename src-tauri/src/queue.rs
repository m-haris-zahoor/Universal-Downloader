use crate::{analyze::friendly_error, bins, db};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    pub settings: Mutex<db::Settings>,
    pub jobs: Mutex<Vec<Job>>,
    pub cache_dir: std::path::PathBuf,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct DownloadReq {
    pub url: String,
    pub title: String,
    pub thumbnail: Option<String>,
    pub platform: String,
    pub kind: String, // "video" | "audio"
    pub height: Option<u32>,
    pub container: String,
    pub audio_format: String,
    pub audio_bitrate: Option<u32>,
    pub est_size: Option<u64>,
    #[serde(default)]
    pub hq: bool,
}

#[derive(Clone, Copy, Serialize, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Status { Queued, Downloading, Processing, Paused, Completed, Failed, Canceled }

#[derive(Clone, Serialize)]
pub struct Job {
    pub id: String,
    pub req: DownloadReq,
    pub status: Status,
    pub percent: f64,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub speed: Option<f64>,
    pub eta: Option<u64>,
    pub error: Option<String>,
    pub file_path: Option<String>,
    #[serde(skip)]
    pub pid: Option<u32>,
}

pub fn emit(app: &AppHandle) {
    let jobs = app.state::<AppState>().jobs.lock().unwrap().clone();
    let _ = app.emit("queue-update", jobs);
}

fn with_job<R>(app: &AppHandle, id: &str, f: impl FnOnce(&mut Job) -> R) -> Option<R> {
    let st = app.state::<AppState>();
    let mut jobs = st.jobs.lock().unwrap();
    jobs.iter_mut().find(|j| j.id == id).map(f)
}

pub fn enqueue(app: &AppHandle, req: DownloadReq) -> Result<String, String> {
    crate::analyze::validate_url(&req.url)?;
    let id = uuid::Uuid::new_v4().to_string();
    let job = Job { id: id.clone(), req, status: Status::Queued, percent: 0.0, downloaded: 0, total: None, speed: None, eta: None, error: None, file_path: None, pid: None };
    app.state::<AppState>().jobs.lock().unwrap().push(job);
    pump(app);
    Ok(id)
}

pub fn add_failed(app: &AppHandle, url: &str, msg: String) {
    let req = DownloadReq { url: url.into(), title: url.into(), thumbnail: None, platform: "Browser".into(), kind: "video".into(), height: None, container: "mp4".into(), audio_format: "mp3".into(), audio_bitrate: None, est_size: None, hq: false };
    let job = Job { id: uuid::Uuid::new_v4().to_string(), req, status: Status::Failed, percent: 0.0, downloaded: 0, total: None, speed: None, eta: None, error: Some(msg), file_path: None, pid: None };
    app.state::<AppState>().jobs.lock().unwrap().push(job);
    emit(app);
}

pub fn pump(app: &AppHandle) {
    let st = app.state::<AppState>();
    let max = st.settings.lock().unwrap().max_concurrent.clamp(1, 10);
    let mut start = vec![];
    {
        let mut jobs = st.jobs.lock().unwrap();
        let mut running = jobs.iter().filter(|j| matches!(j.status, Status::Downloading | Status::Processing)).count();
        for j in jobs.iter_mut().filter(|j| j.status == Status::Queued) {
            if running >= max { break; }
            j.status = Status::Downloading;
            j.error = None;
            running += 1;
            start.push(j.id.clone());
        }
    }
    for id in start {
        let app = app.clone();
        tauri::async_runtime::spawn(run_job(app, id));
    }
    emit(app);
}

pub fn control(app: &AppHandle, id: &str, action: &str) -> Result<(), String> {
    let pid = with_job(app, id, |j| {
        let pid = j.pid.take();
        match (action, j.status) {
            ("pause", Status::Downloading | Status::Processing | Status::Queued) => { j.status = Status::Paused; j.speed = None; j.eta = None; }
            ("cancel", Status::Downloading | Status::Processing | Status::Queued | Status::Paused) => { j.status = Status::Canceled; j.speed = None; j.eta = None; }
            ("resume", Status::Paused) | ("retry", Status::Failed | Status::Canceled) => {
                j.status = Status::Queued; j.error = None;
                if action == "retry" { j.percent = 0.0; j.downloaded = 0; }
            }
            _ => {}
        }
        pid
    }).ok_or("Download not found")?;
    if matches!(action, "pause" | "cancel") {
        if let Some(p) = pid { bins::kill_tree(p); }
    }
    pump(app);
    Ok(())
}

pub fn remove(app: &AppHandle, id: Option<&str>) {
    let st = app.state::<AppState>();
    st.jobs.lock().unwrap().retain(|j| {
        let finished = matches!(j.status, Status::Completed | Status::Failed | Status::Canceled);
        !(finished && id.map_or(true, |i| i == j.id))
    });
    emit(app);
}

pub fn video_selector(height: Option<u32>, container: &str, hq: bool) -> String {
    let h = height.map(|h| format!("[height<={h}]")).unwrap_or_default();
    let generic = format!("bv*{h}+ba/b{h}");
    if hq { return generic; } // highest-resolution/bitrate streams in any codec (VP9/AV1 allowed)
    match container {
        "mp4" => format!("bv*{h}[ext=mp4]+ba[ext=m4a]/{generic}"),
        "webm" => format!("bv*{h}[ext=webm]+ba[ext=webm]/{generic}"),
        _ => generic,
    }
}

pub fn build_args(req: &DownloadReq, out_dir: &str, tmp: &str, ffmpeg_dir: Option<&str>) -> Vec<String> {
    let mut a: Vec<String> = [
        "--no-playlist", "--no-warnings", "--newline", "--progress", "--encoding", "utf-8",
        "--progress-template", "download:PROG|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.format_id)s",
        "--progress-template", "postprocess:PP|%(progress.status)s",
        "--print", "after_move:FILE|%(filepath)s",
        "--windows-filenames", "--trim-filenames", "180", "--no-mtime", "--embed-metadata",
        "--retries", "5", "--fragment-retries", "5", "--concurrent-fragments", "4",
        "-o", "%(title)s [%(id)s].%(ext)s",
    ].iter().map(|s| s.to_string()).collect();
    a.extend(["--paths".into(), format!("home:{out_dir}"), "--paths".into(), format!("temp:{tmp}")]);
    if let Some(d) = ffmpeg_dir { a.extend(["--ffmpeg-location".into(), d.into()]); }
    if req.kind == "audio" {
        let fmt = req.audio_format.as_str();
        let sel = if fmt == "m4a" && req.audio_bitrate.is_none() { "ba[ext=m4a]/ba/b" } else { "ba/b" };
        a.extend(["-f".into(), sel.into(), "-x".into(), "--audio-format".into(), fmt.into()]);
        match (req.audio_bitrate, fmt) {
            (Some(k), "mp3" | "m4a" | "opus") => a.extend(["--audio-quality".into(), format!("{k}K")]),
            (None, "mp3") => a.extend(["--audio-quality".into(), "0".into()]),
            _ => {}
        }
    } else {
        a.extend(["-f".into(), video_selector(req.height, &req.container, req.hq), "--merge-output-format".into(), req.container.clone()]);
        if req.container != "webm" { a.extend(["--remux-video".into(), req.container.clone()]); }
    }
    a.push("--".into());
    a.push(req.url.clone());
    a
}

fn num(s: &str) -> Option<f64> { s.trim().parse::<f64>().ok().filter(|v| v.is_finite()) }

fn fail(app: &AppHandle, id: &str, msg: String) {
    eprintln!("job {id} failed: {msg}");
    with_job(app, id, |j| {
        if matches!(j.status, Status::Downloading | Status::Processing) {
            j.status = Status::Failed; j.error = Some(msg); j.speed = None; j.eta = None; j.pid = None;
        }
    });
    pump(app);
}

async fn run_job(app: AppHandle, id: String) {
    let st = app.state::<AppState>();
    let Some(req) = with_job(&app, &id, |j| j.req.clone()) else { return };
    let settings = st.settings.lock().unwrap().clone();
    let Some(ytdlp) = bins::find(&app, "yt-dlp") else { return fail(&app, &id, "yt-dlp was not found.".into()) };
    if bins::find(&app, "ffmpeg").is_none() { return fail(&app, &id, "FFmpeg was not found.".into()); }
    let ffdir = bins::find(&app, "ffmpeg").and_then(|p| p.parent().map(|d| d.display().to_string()));
    let tmp = st.cache_dir.join("tmp");
    let _ = std::fs::create_dir_all(&tmp);
    if let Err(e) = std::fs::create_dir_all(&settings.download_dir) { return fail(&app, &id, format!("Cannot create download folder: {e}")); }

    let args = build_args(&req, &settings.download_dir, &tmp.display().to_string(), ffdir.as_deref());
    let mut cmd = bins::command(&ytdlp);
    cmd.args(&args).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
    let mut child = match cmd.spawn() { Ok(c) => c, Err(e) => return fail(&app, &id, format!("Failed to start yt-dlp: {e}")) };
    with_job(&app, &id, |j| j.pid = child.id());
    // If the job was paused/canceled between pump and spawn, stop now.
    if with_job(&app, &id, |j| !matches!(j.status, Status::Downloading | Status::Processing)).unwrap_or(true) {
        if let Some(p) = child.id() { bins::kill_tree(p); }
        return;
    }

    let stderr = child.stderr.take().unwrap();
    let err_task = tokio::spawn(async move {
        let mut r = BufReader::new(stderr);
        let (mut buf, mut last) = (Vec::new(), None);
        while r.read_until(b'\n', &mut buf).await.unwrap_or(0) > 0 {
            let l = String::from_utf8_lossy(&buf).trim().to_string();
            if l.starts_with("ERROR") { last = Some(l); }
            buf.clear();
        }
        last
    });

    let mut r = BufReader::new(child.stdout.take().unwrap());
    let mut buf = Vec::new();
    let (mut cur_fid, mut prior, mut last_total, mut last_dl) = (String::new(), 0f64, 0f64, 0f64);
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    while r.read_until(b'\n', &mut buf).await.unwrap_or(0) > 0 {
        let line = String::from_utf8_lossy(&buf).trim().to_string();
        buf.clear();
        if let Some(rest) = line.strip_prefix("PROG|") {
            let p: Vec<&str> = rest.split('|').collect();
            if p.len() < 6 { continue; }
            let dl = num(p[0]).unwrap_or(0.0);
            let total = num(p[1]).or(num(p[2])).unwrap_or(0.0);
            if !cur_fid.is_empty() && cur_fid != p[5] { prior += last_total.max(last_dl); }
            cur_fid = p[5].to_string();
            last_total = total; last_dl = dl;
            let overall = prior + dl;
            let all = if total > 0.0 { (prior + total).max(req.est_size.unwrap_or(0) as f64) } else { req.est_size.unwrap_or(0) as f64 };
            with_job(&app, &id, |j| {
                if j.status == Status::Downloading || j.status == Status::Processing {
                    j.status = Status::Downloading;
                    j.downloaded = overall as u64;
                    j.total = if all > 0.0 { Some(all as u64) } else { None };
                    j.percent = if all > 0.0 { (overall / all * 100.0).min(99.5) } else { 0.0 };
                    j.speed = num(p[3]);
                    j.eta = num(p[4]).map(|v| v as u64);
                }
            });
            if last_emit.elapsed() > Duration::from_millis(250) { emit(&app); last_emit = Instant::now(); }
        } else if line.starts_with("PP|") {
            with_job(&app, &id, |j| if j.status == Status::Downloading { j.status = Status::Processing; j.percent = j.percent.max(99.0); j.speed = None; j.eta = None; });
            emit(&app);
        } else if let Some(path) = line.strip_prefix("FILE|") {
            with_job(&app, &id, |j| j.file_path = Some(path.to_string()));
        }
    }
    let exit = child.wait().await;
    let last_err = err_task.await.ok().flatten();

    // Paused/canceled jobs were already updated by `control`.
    if with_job(&app, &id, |j| !matches!(j.status, Status::Downloading | Status::Processing)).unwrap_or(true) { pump(&app); return; }
    let ok = exit.map(|s| s.success()).unwrap_or(false);
    let path = with_job(&app, &id, |j| j.file_path.clone()).flatten();
    match (ok, path) {
        (true, Some(p)) if Path::new(&p).exists() => complete(&app, &id, &req, &p).await,
        (true, _) => fail(&app, &id, "Finished, but no output file was produced.".into()),
        (false, _) => fail(&app, &id, friendly_error(&last_err.unwrap_or_else(|| "Download failed.".into()))),
    }
}

async fn probe(app: &AppHandle, path: &str, audio: bool) -> Option<String> {
    let ffprobe = bins::find(app, "ffprobe")?;
    let entry = if audio { "format=bit_rate" } else { "stream=height" };
    let mut c = bins::command(&ffprobe);
    c.args(["-v", "error"]);
    if !audio { c.args(["-select_streams", "v:0"]); }
    c.args(["-show_entries", entry, "-of", "csv=p=0", path]);
    let out = c.output().await.ok()?;
    let v: f64 = String::from_utf8_lossy(&out.stdout).trim().split(',').next()?.parse().ok()?;
    Some(if audio { format!("{} kbps", (v / 1000.0).round()) } else { format!("{}p", v as u32) })
}

async fn complete(app: &AppHandle, id: &str, req: &DownloadReq, path: &str) {
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let audio = req.kind == "audio";
    let resolution = probe(app, path, audio).await.unwrap_or_else(|| if audio { "—".into() } else { req.height.map_or("Best".into(), |h| format!("{h}p")) });
    let ext = Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("").to_uppercase();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let item = db::HistoryItem {
        id: id.into(), title: req.title.clone(), thumbnail: req.thumbnail.clone(), url: req.url.clone(), platform: req.platform.clone(),
        file_path: path.into(), kind: req.kind.clone(), resolution, format: ext, size, created_at: now, exists: true,
    };
    let _ = db::add_history(&app.state::<AppState>().db.lock().unwrap(), &item);
    with_job(app, id, |j| { j.status = Status::Completed; j.percent = 100.0; j.downloaded = size; j.total = Some(size); j.speed = None; j.eta = None; j.pid = None; });
    let _ = app.emit("history-update", ());
    pump(app);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selector() {
        assert_eq!(video_selector(Some(1080), "mkv", false), "bv*[height<=1080]+ba/b[height<=1080]");
        assert_eq!(video_selector(None, "mp4", true), "bv*+ba/b");
        assert!(video_selector(None, "mp4", false).starts_with("bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b"));
    }
    #[test]
    fn url_validation() {
        assert!(crate::analyze::validate_url("https://youtu.be/x").is_ok());
        assert!(crate::analyze::validate_url("file:///etc/passwd").is_err());
        assert!(crate::analyze::validate_url("--exec=rm").is_err());
    }
    #[test]
    fn audio_args() {
        let r = DownloadReq { url: "https://a.b/c".into(), title: "t".into(), thumbnail: None, platform: "x".into(), kind: "audio".into(), height: None, container: "mp4".into(), audio_format: "mp3".into(), audio_bitrate: Some(320), est_size: None, hq: false };
        let a = build_args(&r, "/o", "/t", None);
        assert!(a.windows(2).any(|w| w == ["--audio-quality", "320K"]));
        assert_eq!(a[a.len() - 2], "--");
    }
}
