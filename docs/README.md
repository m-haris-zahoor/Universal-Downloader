# Universal Downloader

Tauri 2 + React/TS + Tailwind 4 + Rust. Extraction via yt-dlp, processing via FFmpeg/FFprobe, SQLite for settings/history.

- `src/` UI (pages, components, services). `src-tauri/src/` Rust backend: `analyze.rs` (metadata), `queue.rs` (job queue, pause/resume/cancel, progress parsing), `db.rs` (SQLite), `bins.rs` (binary lookup).
- Binaries are looked up in the bundled `resources/bin`, then Homebrew/system paths, then PATH.

## Dev
`npm install && npm run tauri dev` (needs Rust, yt-dlp, ffmpeg on PATH).

## Windows installer
Must be built on Windows (or CI): push a `v*` tag or run the *Build Windows installer* workflow. It downloads yt-dlp/ffmpeg/ffprobe into `src-tauri/resources/bin` and produces an NSIS `.exe` bundling them.
Locally on Windows: `node scripts/fetch-binaries.mjs && npx tauri build --bundles nsis`.

## Tests
`cd src-tauri && cargo test`

## Browser extension (`extension/`)
The desktop app listens on `127.0.0.1:17893` (extension origins only). The extension adds a toolbar popup, right-click menu and a Download button over videos; it sends the page URL to the app, which queues it with your default settings. The app must be running.
- **Chrome/Edge/Brave:** `chrome://extensions` → Developer mode → Load unpacked → select `extension/` (or use the zip).
- **Safari (macOS):** install Xcode, run `scripts/safari-extension.sh`, Run the project in Xcode, enable it in Safari → Settings → Extensions.
