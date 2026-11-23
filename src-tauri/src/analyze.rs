use crate::bins;
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::time::Duration;
use tauri::AppHandle;

#[derive(Serialize)]
pub struct HeightOpt {
    pub height: u32,
    pub size: Option<u64>,
}

#[derive(Serialize)]
pub struct MediaInfo {
    pub url: String,
    pub title: String,
    pub thumbnail: Option<String>,
    pub duration: Option<f64>,
    pub uploader: Option<String>,
    pub platform: String,
    pub has_video: bool,
    pub has_audio: bool,
    pub heights: Vec<HeightOpt>,
    pub video_size: Option<u64>, // best video (no height info) estimated size
    pub audio_size: Option<u64>,
    pub audio_abr: Option<f64>,
    pub audio_codec: Option<String>,
}

pub fn validate_url(s: &str) -> Result<url::Url, String> {
    let u = url::Url::parse(s.trim()).map_err(|_| "That doesn't look like a valid URL.".to_string())?;
    if !matches!(u.scheme(), "http" | "https") || u.host_str().is_none() {
        return Err("Only http(s) URLs are supported.".into());
    }
    Ok(u)
}

fn size_of(f: &Value, dur: Option<f64>) -> Option<u64> {
    f["filesize"].as_f64().or(f["filesize_approx"].as_f64()).or_else(|| {
        let tbr = f["tbr"].as_f64()?;
        Some(tbr * 1000.0 / 8.0 * dur?)
    }).map(|v| v as u64)
}

fn codec(f: &Value, k: &str) -> Option<String> {
    f[k].as_str().map(|s| s.to_string())
}

pub fn friendly_error(raw: &str) -> String {
    let l = raw.to_lowercase();
    if l.contains("drm") { "This content is DRM-protected and can't be downloaded.".into() }
    else if l.contains("private") || l.contains("sign in") || l.contains("log in") || l.contains("login") || l.contains("members-only") || l.contains("age") && l.contains("confirm") {
        "This content is private or requires login. Only publicly accessible media is supported.".into()
    }
    else if l.contains("unsupported url") { "This URL isn't supported by the extraction engine.".into() }
    else if l.contains("is_live") || l.contains("live event") || l.contains("live stream") { "Live streams aren't supported.".into() }
    else if l.contains("urlopen error") || l.contains("unable to download") && l.contains("network") { "Network error. Check your connection and try again.".into() }
    else { raw.trim_start_matches("ERROR: ").trim().to_string() }
}

pub async fn analyze(app: &AppHandle, raw_url: &str) -> Result<MediaInfo, String> {
    let url = validate_url(raw_url)?.to_string();
    let ytdlp = bins::find(app, "yt-dlp").ok_or("yt-dlp was not found. See Settings → Tools.")?;
    let mut cmd = bins::command(&ytdlp);
    cmd.args(["-J", "--no-playlist", "--no-warnings", "--skip-download", "--encoding", "utf-8", "--socket-timeout", "20", "--", &url]);
    let out = tokio::time::timeout(Duration::from_secs(90), cmd.output())
        .await
        .map_err(|_| "Timed out while reading media information.".to_string())?
        .map_err(|e| format!("Failed to run yt-dlp: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let line = err.lines().rev().find(|l| l.starts_with("ERROR")).unwrap_or("Could not read this URL.");
        return Err(friendly_error(line));
    }
    let mut v: Value = serde_json::from_slice(&out.stdout).map_err(|e| format!("Unexpected yt-dlp output: {e}"))?;
    if let Some(first) = v["entries"].as_array().and_then(|a| a.iter().find(|e| !e.is_null())).cloned() {
        v = first;
    }
    if v["is_live"].as_bool().unwrap_or(false) {
        return Err("Live streams aren't supported.".into());
    }
    let dur = v["duration"].as_f64();
    let empty = vec![];
    let formats = v["formats"].as_array().unwrap_or(&empty);

    let mut heights: BTreeMap<u32, (Option<u64>, bool)> = BTreeMap::new();
    let (mut has_video, mut has_audio) = (false, false);
    let mut video_size: Option<u64> = None;
    let mut best_audio: Option<(f64, Option<u64>, Option<String>)> = None;
    let vid_ext = ["mp4", "webm", "mkv", "mov", "m4v", "avi", "flv", "ts", "m3u8"];

    for f in formats {
        let vc = f["vcodec"].as_str();
        let ac = f["acodec"].as_str();
        let is_video = match vc { Some(c) => c != "none", None => f["ext"].as_str().map_or(false, |e| vid_ext.contains(&e)) };
        let is_audio = ac.map_or(true, |c| c != "none");
        if f["format_id"].as_str().map_or(false, |i| i.starts_with("sb")) { continue; }
        let sz = size_of(f, dur);
        if is_video {
            has_video = true;
            let carries_audio = ac.map_or(false, |c| c != "none");
            if let Some(h) = f["height"].as_u64() {
                let e = heights.entry(h as u32).or_insert((None, false));
                if sz.unwrap_or(0) >= e.0.unwrap_or(0) { *e = (sz, carries_audio); }
            } else if sz.unwrap_or(0) >= video_size.unwrap_or(0) { video_size = sz; }
        }
        if is_audio { has_audio = true; }
        if !is_video && is_audio {
            let abr = f["abr"].as_f64().or(f["tbr"].as_f64()).unwrap_or(0.0);
            if best_audio.as_ref().map_or(true, |b| abr > b.0) {
                best_audio = Some((abr, sz, codec(f, "acodec")));
            }
        }
    }
    let audio_size = best_audio.as_ref().and_then(|b| b.1);
    let heights = heights.into_iter().map(|(h, (s, carries))| HeightOpt {
        height: h,
        size: s.map(|s| if carries { s } else { s + audio_size.unwrap_or(0) }),
    }).collect();

    let thumbnail = v["thumbnail"].as_str().map(String::from).or_else(|| {
        v["thumbnails"].as_array().and_then(|a| a.iter().rev().find_map(|t| t["url"].as_str().map(String::from)))
    });
    Ok(MediaInfo {
        url: v["webpage_url"].as_str().unwrap_or(&url).to_string(),
        title: v["title"].as_str().unwrap_or("Untitled").to_string(),
        thumbnail,
        duration: dur,
        uploader: v["uploader"].as_str().or(v["channel"].as_str()).map(String::from),
        platform: v["extractor_key"].as_str().unwrap_or("Generic").to_string(),
        has_video, has_audio, heights, video_size,
        audio_size,
        audio_abr: best_audio.as_ref().map(|b| b.0).filter(|a| *a > 0.0),
        audio_codec: best_audio.and_then(|b| b.2),
    })
}
