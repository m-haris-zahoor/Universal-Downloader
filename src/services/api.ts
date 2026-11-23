import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface MediaInfo {
  url: string; title: string; thumbnail: string | null; duration: number | null; uploader: string | null;
  platform: string; has_video: boolean; has_audio: boolean;
  heights: { height: number; size: number | null }[];
  video_size: number | null; audio_size: number | null; audio_abr: number | null; audio_codec: string | null;
}
export interface DownloadReq {
  url: string; title: string; thumbnail: string | null; platform: string; kind: "video" | "audio";
  height: number | null; container: string; audio_format: string; audio_bitrate: number | null; est_size: number | null; hq: boolean;
}
export type Status = "queued" | "downloading" | "processing" | "paused" | "completed" | "failed" | "canceled";
export interface Job {
  id: string; req: DownloadReq; status: Status; percent: number; downloaded: number; total: number | null;
  speed: number | null; eta: number | null; error: string | null; file_path: string | null;
}
export interface HistoryItem {
  id: string; title: string; thumbnail: string | null; url: string; platform: string; file_path: string;
  kind: string; resolution: string; format: string; size: number; created_at: number; exists: boolean;
}
export interface Settings {
  download_dir: string; video_quality: string; audio_quality: string; video_format: string; audio_format: string;
  max_concurrent: number; clipboard_detect: boolean; theme: "dark" | "light"; prefer_hq: boolean;
}
export interface ToolInfo { name: string; found: boolean; path: string | null; version: string | null }
export interface Tools { ytdlp: ToolInfo; ffmpeg: ToolInfo; ffprobe: ToolInfo }

export const api = {
  analyze: (url: string) => invoke<MediaInfo>("analyze", { url }),
  enqueue: (req: DownloadReq) => invoke<string>("enqueue", { req }),
  listJobs: () => invoke<Job[]>("list_jobs"),
  jobControl: (id: string, action: "pause" | "resume" | "cancel" | "retry") => invoke<void>("job_control", { id, action }),
  removeJobs: (id?: string) => invoke<void>("remove_jobs", { id: id ?? null }),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  history: () => invoke<HistoryItem[]>("get_history"),
  deleteHistory: (id: string) => invoke<void>("delete_history", { id }),
  openFile: (path: string) => invoke<void>("open_file", { path }),
  revealFile: (path: string) => invoke<void>("reveal_file", { path }),
  openDownloadDir: () => invoke<void>("open_download_dir"),
  toolStatus: () => invoke<Tools>("tool_status"),
  clearCache: () => invoke<number>("clear_cache"),
  onQueue: (cb: (jobs: Job[]) => void) => listen<Job[]>("queue-update", (e) => cb(e.payload)),
  onHistory: (cb: () => void) => listen("history-update", cb),
};

export const errMsg = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "Something went wrong.");
