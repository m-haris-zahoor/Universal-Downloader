//! Local HTTP bridge (127.0.0.1 only) so the browser extension can send links to the app.
//! Only requests from browser-extension origins are accepted; web pages are rejected.
use crate::{analyze, db, queue};
use std::io::Read;
use tauri::{AppHandle, Manager};
use tiny_http::{Header, Method, Request, Response, Server};

pub const PORT: u16 = 17893;

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let server = match Server::http(("127.0.0.1", PORT)) {
            Ok(s) => s,
            Err(e) => { eprintln!("bridge: cannot listen on {PORT}: {e}"); return; }
        };
        for req in server.incoming_requests() {
            let app = app.clone();
            std::thread::spawn(move || handle(app, req));
        }
    });
}

fn hdr(k: &str, v: &str) -> Header { Header::from_bytes(k.as_bytes(), v.as_bytes()).unwrap() }

fn origin_ok(o: &str) -> bool {
    ["chrome-extension://", "safari-web-extension://", "moz-extension://"].iter().any(|p| o.starts_with(p))
}

fn handle(app: AppHandle, mut req: Request) {
    let origin = req.headers().iter().find(|h| h.field.equiv("Origin")).map(|h| h.value.to_string()).unwrap_or_default();
    if !origin_ok(&origin) {
        let _ = req.respond(Response::from_string("forbidden").with_status_code(403));
        return;
    }
    let cors = [hdr("Access-Control-Allow-Origin", &origin), hdr("Access-Control-Allow-Headers", "content-type"),
                hdr("Access-Control-Allow-Methods", "GET, POST, OPTIONS"), hdr("Content-Type", "application/json")];
    let reply = |req: Request, code: u16, body: serde_json::Value| {
        let mut r = Response::from_string(body.to_string()).with_status_code(code);
        for h in cors.iter().cloned() { r.add_header(h); }
        let _ = req.respond(r);
    };
    let path = req.url().split('?').next().unwrap_or("").to_string();
    match (req.method().clone(), path.as_str()) {
        (Method::Options, _) => reply(req, 204, serde_json::json!({})),
        (Method::Get, "/ping") => reply(req, 200, serde_json::json!({"ok": true, "app": "universal-downloader"})),
        (Method::Post, "/enqueue") => {
            let mut body = String::new();
            let _ = req.as_reader().take(65536).read_to_string(&mut body);
            let v: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
            let out = tauri::async_runtime::block_on(quick_enqueue(&app, &v));
            match out {
                Ok(title) => reply(req, 200, serde_json::json!({"ok": true, "title": title})),
                Err(e) => reply(req, 200, serde_json::json!({"ok": false, "error": e})),
            }
        }
        _ => reply(req, 404, serde_json::json!({"ok": false, "error": "not found"})),
    }
}

async fn quick_enqueue(app: &AppHandle, v: &serde_json::Value) -> Result<String, String> {
    let url = v["url"].as_str().ok_or("Missing URL")?;
    let info = analyze::analyze(app, url).await?;
    let s: db::Settings = app.state::<queue::AppState>().settings.lock().unwrap().clone();
    let want_audio = match v["kind"].as_str() { Some("audio") => true, Some("video") => false, _ => !info.has_video };
    if want_audio && !info.has_audio { return Err("This media has no audio track.".into()); }
    let height = match v["height"].as_u64() {
        Some(h) => Some(h as u32),
        None => s.video_quality.parse::<u32>().ok(),
    };
    let est = info.heights.iter().filter(|h| height.map_or(true, |m| h.height <= m)).last().and_then(|h| h.size);
    let req = queue::DownloadReq {
        url: info.url.clone(), title: info.title.clone(), thumbnail: info.thumbnail.clone(), platform: info.platform.clone(),
        kind: if want_audio { "audio" } else { "video" }.into(),
        height: if want_audio { None } else { height },
        container: s.video_format.clone(),
        audio_format: v["audio_format"].as_str().filter(|f| ["mp3", "m4a", "wav", "flac", "opus"].contains(f)).unwrap_or(&s.audio_format).to_string(),
        audio_bitrate: s.audio_quality.parse::<u32>().ok(),
        est_size: est, hq: s.prefer_hq,
    };
    queue::enqueue(app, req)?;
    Ok(info.title)
}
