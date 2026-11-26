//! Splits an uploaded song into vocals and instrumental with the bundled sherpa-onnx engine (UVR-MDX model).
use crate::{bins, db, queue::AppState};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SepStatus { Queued, Preparing, Separating, Saving, Completed, Failed, Canceled }

#[derive(Clone, Serialize)]
pub struct SepJob {
    pub id: String,
    pub name: String,
    pub input: String,
    pub format: String,
    pub even: bool,
    pub status: SepStatus,
    pub started_at: Option<u64>,
    pub vocals: Option<String>,
    pub instrumental: Option<String>,
    pub error: Option<String>,
    #[serde(skip)]
    pub pid: Option<u32>,
}

#[derive(Default)]
pub struct SepState {
    pub jobs: Mutex<Vec<SepJob>>,
    turn: Arc<tokio::sync::Mutex<()>>, // one separation at a time: it is CPU heavy
}

fn now() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) }

pub fn list(app: &AppHandle) -> Vec<SepJob> { app.state::<SepState>().jobs.lock().unwrap().clone() }
fn emit(app: &AppHandle) { let _ = app.emit("sep-update", list(app)); }

fn finished(s: SepStatus) -> bool { matches!(s, SepStatus::Completed | SepStatus::Failed | SepStatus::Canceled) }

/// Applies a change only while the job is still active (so cancel always wins).
fn update(app: &AppHandle, id: &str, f: impl FnOnce(&mut SepJob)) -> bool {
    let ok = {
        let st = app.state::<SepState>();
        let mut jobs = st.jobs.lock().unwrap();
        match jobs.iter_mut().find(|j| j.id == id && !finished(j.status)) { Some(j) => { f(j); true } None => false }
    };
    emit(app);
    ok
}

pub fn start(app: &AppHandle, path: String, format: String, even: bool) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.is_absolute() || !p.is_file() { return Err("File not found.".into()); }
    if !["mp3", "wav", "flac", "m4a"].contains(&format.as_str()) { return Err("Unsupported output format.".into()); }
    let id = uuid::Uuid::new_v4().to_string();
    let name = p.file_stem().and_then(|s| s.to_str()).unwrap_or("track").to_string();
    app.state::<SepState>().jobs.lock().unwrap().push(SepJob {
        id: id.clone(), name, input: path, format, even, status: SepStatus::Queued, started_at: None, vocals: None, instrumental: None, error: None, pid: None,
    });
    emit(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let turn = app.state::<SepState>().turn.clone();
        let _guard = turn.lock().await;
        let tmp = app.state::<AppState>().cache_dir.join("separate").join(&id);
        let result = run(&app, &id, &tmp).await;
        let _ = std::fs::remove_dir_all(&tmp);
        if let Err(e) = result {
            update(&app, &id, |j| { j.status = SepStatus::Failed; j.error = Some(e); j.pid = None; });
        }
    });
    Ok(())
}

pub fn cancel(app: &AppHandle, id: &str) {
    let mut pid = None;
    update(app, id, |j| { j.status = SepStatus::Canceled; pid = j.pid.take(); });
    if let Some(p) = pid { bins::kill_tree(p); }
}

pub fn remove(app: &AppHandle, id: &str) {
    app.state::<SepState>().jobs.lock().unwrap().retain(|j| !(j.id == id && finished(j.status)));
    emit(app);
}

/// Runs a tool as a cancelable step of a job.
async fn step(app: &AppHandle, id: &str, exe: &PathBuf, args: &[String], what: &str) -> Result<(), String> {
    let mut cmd = bins::command(exe);
    cmd.args(args).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::piped());
    let child = cmd.spawn().map_err(|e| format!("{what} could not start: {e}"))?;
    let pid = child.id();
    if !update(app, id, |j| j.pid = pid) {
        if let Some(p) = pid { bins::kill_tree(p); }
        return Ok(());
    }
    let out = child.wait_with_output().await.map_err(|e| e.to_string())?;
    if out.status.success() { return Ok(()); }
    let err = String::from_utf8_lossy(&out.stderr);
    Err(format!("{what} failed: {}", err.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("unknown error")))
}

fn free_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let mut p = dir.join(format!("{stem}.{ext}"));
    let mut n = 2;
    while p.exists() { p = dir.join(format!("{stem} ({n}).{ext}")); n += 1; }
    p
}

async fn run(app: &AppHandle, id: &str, tmp: &Path) -> Result<(), String> {
    let Some(job) = list(app).into_iter().find(|j| j.id == id) else { return Ok(()) };
    let ffmpeg = bins::find(app, "ffmpeg").ok_or("FFmpeg was not found.")?;
    let engine = bins::find(app, "separator").ok_or("The vocal separation engine is not installed.")?;
    let model = engine.with_file_name("uvr.onnx");
    let inst_model = engine.with_file_name("inst.onnx");
    if !model.is_file() || !inst_model.is_file() { return Err("A vocal separation model is missing.".into()); }
    std::fs::create_dir_all(tmp).map_err(|e| e.to_string())?;
    let s = |p: &Path| p.display().to_string();
    let (input, voc, ins) = (tmp.join("input.wav"), tmp.join("vocals.wav"), tmp.join("instrumental.wav"));

    if !update(app, id, |j| { j.status = SepStatus::Preparing; j.started_at = Some(now()); }) { return Ok(()); }
    let args: Vec<String> = ["-v", "error", "-y", "-i", &job.input, "-vn", "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", &s(&input)].iter().map(|a| a.to_string()).collect();
    step(app, id, &ffmpeg, &args, "Reading the audio").await?;

    if !update(app, id, |j| j.status = SepStatus::Separating) { return Ok(()); }
    let threads = std::thread::available_parallelism().map(|n| n.get().min(8)).unwrap_or(4);
    // Two models: each is only trusted for the stem it was trained to predict.
    // The engine writes a model's own prediction to --output-vocals-wav, so for the
    // instrumental model that slot holds the instrumental.
    let unused = tmp.join("unused.wav");
    for (model, target) in [(&model, &voc), (&inst_model, &ins)] {
        let args = vec![
            format!("--uvr-model={}", s(model)), format!("--num-threads={threads}"), format!("--input-wav={}", s(&input)),
            format!("--output-vocals-wav={}", s(target)), format!("--output-accompaniment-wav={}", s(&unused)),
        ];
        step(app, id, &engine, &args, "Separation").await?;
        if !update(app, id, |_| {}) { return Ok(()); }
    }

    if !update(app, id, |j| j.status = SepStatus::Saving) { return Ok(()); }
    let dir = PathBuf::from(app.state::<AppState>().settings.lock().unwrap().download_dir.clone()).join("Separated");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create output folder: {e}"))?;
    let mut outputs = vec![];
    for (src, label) in [(&voc, "Vocals"), (&ins, "Instrumental")] {
        let dst = free_path(&dir, &format!("{} - {label}", job.name), &job.format);
        let mut args: Vec<String> = ["-v", "error", "-n", "-i", &s(src)].iter().map(|a| a.to_string()).collect();
        if job.format == "mp3" { args.extend(["-b:a".into(), "320k".into()]); }
        if job.format == "m4a" { args.extend(["-b:a".into(), "256k".into()]); }
        // Lift passages that sound quieter once the voice is gone (limited to +12 dB).
        if job.even && label == "Instrumental" { args.extend(["-af".into(), "dynaudnorm=f=250:g=15:p=0.95:m=4".into(), "-ar".into(), "44100".into()]); }
        args.push(s(&dst));
        step(app, id, &ffmpeg, &args, "Saving").await?;
        if !dst.exists() { return Ok(()); } // canceled
        outputs.push((dst, label));
    }

    let st = app.state::<AppState>();
    for (path, label) in &outputs {
        let item = db::HistoryItem {
            id: uuid::Uuid::new_v4().to_string(), title: format!("{} - {label}", job.name), thumbnail: None, url: job.input.clone(),
            platform: "Vocal Remover".into(), file_path: s(path), kind: "audio".into(), resolution: label.to_string(),
            format: job.format.to_uppercase(), size: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0), created_at: now() as i64, exists: true,
        };
        let _ = db::add_history(&st.db.lock().unwrap(), &item);
    }
    update(app, id, |j| { j.vocals = Some(s(&outputs[0].0)); j.instrumental = Some(s(&outputs[1].0)); j.status = SepStatus::Completed; j.pid = None; });
    let _ = app.emit("history-update", ());
    Ok(())
}
