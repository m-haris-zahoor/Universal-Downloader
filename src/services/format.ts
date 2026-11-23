export function bytes(n?: number | null) {
  if (!n || n <= 0) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${u[i]}`;
}
export function duration(s?: number | null) {
  if (!s) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60);
  const p = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`;
}
export const eta = (s?: number | null) => (s == null ? "—" : duration(s));
export const speed = (b?: number | null) => (b ? `${bytes(b)}/s` : "—");
export const date = (ts: number) => new Date(ts * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export const PRESETS = [144, 240, 360, 480, 720, 1080, 1440, 2160];
export const heightLabel = (h: number) => `${h}p${h === 1440 ? " (2K)" : h === 2160 ? " (4K)" : ""}`;
export const VIDEO_FORMATS = ["mp4", "mkv", "webm"];
export const AUDIO_FORMATS = ["mp3", "m4a", "wav", "flac", "opus"];
export const AUDIO_BITRATES = [128, 192, 256, 320];

/** A preset is available only if the source has a stream in (previous preset, preset]. */
export function availablePresets(heights: number[]) {
  return PRESETS.map((p, i) => {
    const lo = i === 0 ? 0 : PRESETS[i - 1];
    const last = i === PRESETS.length - 1;
    return { value: p, enabled: heights.some((h) => h > lo && (last ? true : h <= p)) };
  });
}

export function isUrl(s: string) {
  try { const u = new URL(s.trim()); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; }
}
