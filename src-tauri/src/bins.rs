use std::path::PathBuf;
use std::process::Stdio;
use tauri::{AppHandle, Manager};

pub fn exe(name: &str) -> String {
    if cfg!(windows) { format!("{name}.exe") } else { name.to_string() }
}

/// Locate a bundled or system binary (resources/bin first, then common dirs, then PATH).
pub fn find(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let file = exe(name);
    let mut dirs: Vec<PathBuf> = vec![];
    if let Ok(r) = app.path().resource_dir() {
        dirs.push(r.join("bin"));
        dirs.push(r.join("resources").join("bin"));
    }
    if let Ok(e) = std::env::current_exe() {
        if let Some(p) = e.parent() {
            dirs.push(p.join("bin"));
            dirs.push(p.to_path_buf());
        }
    }
    for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        dirs.push(d.into());
    }
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    dirs.into_iter().map(|d| d.join(&file)).find(|p| p.is_file())
}

pub fn command(path: &PathBuf) -> tokio::process::Command {
    let mut c = tokio::process::Command::new(path);
    #[cfg(windows)]
    c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    #[cfg(unix)]
    c.process_group(0);
    c.env("PYTHONIOENCODING", "utf-8").env("PYTHONUTF8", "1");
    c.stdin(Stdio::null()).kill_on_drop(true);
    c
}

pub fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(0x0800_0000)
            .status();
    }
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("kill").args(["-TERM", "--", &format!("-{pid}")]).status();
    }
}

#[derive(serde::Serialize)]
pub struct ToolInfo {
    pub name: String,
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

pub async fn tool_info(app: &AppHandle, name: &str) -> ToolInfo {
    let Some(p) = find(app, name) else {
        return ToolInfo { name: name.into(), found: false, path: None, version: None };
    };
    let arg = if name == "yt-dlp" { "--version" } else { "-version" };
    let out = command(&p).arg(arg).output().await.ok();
    let version = out.and_then(|o| {
        String::from_utf8_lossy(&o.stdout).lines().next().map(|l| {
            l.replace("ffmpeg version ", "").replace("ffprobe version ", "").split_whitespace().next().unwrap_or("").to_string()
        })
    });
    ToolInfo { name: name.into(), found: true, path: Some(p.display().to_string()), version }
}
