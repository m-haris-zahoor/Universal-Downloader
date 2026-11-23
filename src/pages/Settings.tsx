import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, FolderOpen, Trash2, XCircle } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, errMsg, type Settings, type Tools } from "../services/api";
import { AUDIO_BITRATES, AUDIO_FORMATS, PRESETS, VIDEO_FORMATS, bytes, heightLabel } from "../services/format";
import { Button, Card, Select, Toggle } from "../components/ui";

const Row = ({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) => (
  <div className="flex items-center justify-between gap-6 py-3.5">
    <div><div>{title}</div>{hint && <div className="text-xs text-muted mt-0.5">{hint}</div>}</div>
    <div className="shrink-0">{children}</div>
  </div>
);

export function SettingsPage({ settings, update, toast }: { settings: Settings; update: (s: Settings) => Promise<void>; toast: (m: string, t?: "ok" | "err") => void }) {
  const [tools, setTools] = useState<Tools | null>(null);
  useEffect(() => { api.toolStatus().then(setTools); }, []);
  const set = (p: Partial<Settings>) => update({ ...settings, ...p });

  async function pick() {
    const d = await open({ directory: true, defaultPath: settings.download_dir });
    if (typeof d === "string") set({ download_dir: d });
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <Card className="px-5 divide-y divide-line">
        <Row title="Download location" hint={settings.download_dir}>
          <div className="flex gap-2"><Button onClick={pick}><FolderOpen size={16} />Change</Button><Button variant="ghost" onClick={() => api.openDownloadDir().catch((e) => toast(errMsg(e), "err"))}>Open</Button></div>
        </Row>
        <Row title="Default video quality">
          <div className="w-44"><Select label="" value={settings.video_quality} onChange={(v) => set({ video_quality: v })}>
            <option value="best">Best available</option>{PRESETS.map((p) => <option key={p} value={p}>{heightLabel(p)}</option>)}
          </Select></div>
        </Row>
        <Row title="Default video format">
          <div className="w-44"><Select label="" value={settings.video_format} onChange={(v) => set({ video_format: v })}>
            {VIDEO_FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}</Select></div>
        </Row>
        <Row title="Default audio quality">
          <div className="w-44"><Select label="" value={settings.audio_quality} onChange={(v) => set({ audio_quality: v })}>
            <option value="best">Original / Best</option>{AUDIO_BITRATES.map((b) => <option key={b} value={b}>{b} kbps</option>)}</Select></div>
        </Row>
        <Row title="Default audio format">
          <div className="w-44"><Select label="" value={settings.audio_format} onChange={(v) => set({ audio_format: v })}>
            {AUDIO_FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}</Select></div>
        </Row>
        <Row title="High quality mode by default" hint="Prefer highest-bitrate streams (VP9/AV1) over compatibility.">
          <Toggle checked={settings.prefer_hq} onChange={(v) => set({ prefer_hq: v })} />
        </Row>
        <Row title="Simultaneous downloads">
          <div className="w-44"><Select label="" value={String(settings.max_concurrent)} onChange={(v) => set({ max_concurrent: Number(v) })}>
            {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</Select></div>
        </Row>
        <Row title="Clipboard URL detection" hint="Offer to use a copied link when the app is focused.">
          <Toggle checked={settings.clipboard_detect} onChange={(v) => set({ clipboard_detect: v })} />
        </Row>
        <Row title="Theme">
          <div className="w-44"><Select label="" value={settings.theme} onChange={(v) => set({ theme: v as Settings["theme"] })}>
            <option value="dark">Dark</option><option value="light">Light</option></Select></div>
        </Row>
        <Row title="Cache" hint="Removes leftover partial downloads.">
          <Button onClick={() => api.clearCache().then((n) => toast(`Cleared ${bytes(n)}`)).catch((e) => toast(errMsg(e), "err"))}><Trash2 size={16} />Clear cache</Button>
        </Row>
      </Card>

      <Card className="px-5 py-2 divide-y divide-line">
        <div className="py-3 font-medium">Tools</div>
        {tools && ([["yt-dlp", tools.ytdlp], ["FFmpeg", tools.ffmpeg], ["FFprobe", tools.ffprobe]] as const).map(([n, t]) => (
          <div key={n} className="flex items-center gap-3 py-3">
            {t.found ? <CheckCircle2 size={18} className="text-ok" /> : <XCircle size={18} className="text-err" />}
            <div className="w-20">{n}</div>
            <div className="text-xs text-muted truncate flex-1">{t.found ? `${t.version ?? ""} · ${t.path}` : "Not found"}</div>
          </div>
        ))}
      </Card>
    </div>
  );
}
