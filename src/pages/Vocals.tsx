import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { AlertCircle, FolderOpen, Loader2, MicVocal, Music, Trash2, Upload, X } from "lucide-react";
import { api, errMsg, type SepJob } from "../services/api";
import { duration } from "../services/format";
import { Button, Card, IconButton, Select } from "../components/ui";

const EXT = ["mp3", "wav", "flac", "m4a", "aac", "ogg", "opus", "wma", "aiff", "mp4", "mkv", "webm", "mov"];
const label: Record<SepJob["status"], string> = {
  queued: "Waiting…", preparing: "Reading audio…", separating: "Separating vocals…", saving: "Saving files…",
  completed: "Done", failed: "Failed", canceled: "Canceled",
};

export function Vocals({ toast }: { toast: (m: string, t?: "ok" | "err") => void }) {
  const [jobs, setJobs] = useState<SepJob[]>([]);
  const [format, setFormat] = useState("mp3");
  const [over, setOver] = useState(false);
  const [now, setNow] = useState(Date.now() / 1000);
  const formatRef = useRef(format);
  formatRef.current = format;
  const run = (p: Promise<unknown>) => p.catch((e) => toast(errMsg(e), "err"));

  const add = (paths: string[]) => {
    const ok = paths.filter((p) => EXT.includes(p.split(".").pop()?.toLowerCase() ?? ""));
    if (!ok.length) return toast("Choose an audio or video file.", "err");
    ok.forEach((p) => run(api.sepStart(p, formatRef.current)));
  };

  useEffect(() => {
    api.sepList().then(setJobs);
    const a = api.onSep(setJobs);
    const b = getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "over" || payload.type === "enter") setOver(true);
      else if (payload.type === "drop") { setOver(false); add(payload.paths); }
      else setOver(false);
    });
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => { a.then((u) => u()); b.then((u) => u()); clearInterval(t); };
  }, []);

  async function pick() {
    const f = await open({ multiple: true, filters: [{ name: "Audio / video", extensions: EXT }] });
    if (f) add(Array.isArray(f) ? f : [f]);
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Vocal Remover</h1>
        <p className="text-muted mt-1">Split a song into vocals and instrumental. Everything runs on this computer; nothing is uploaded online.</p>
      </div>

      <Card className={`p-8 border-dashed text-center transition ${over ? "border-accent bg-accent/10" : ""}`}>
        <div className="mx-auto h-12 w-12 rounded-2xl bg-surface2 border border-line flex items-center justify-center mb-3"><Upload size={22} /></div>
        <div className="font-medium">Drop music files here</div>
        <div className="text-sm text-muted mt-1 mb-4">MP3, WAV, FLAC, M4A, OGG and video files</div>
        <div className="flex items-end justify-center gap-3">
          <div className="w-36 text-left"><Select label="Output format" value={format} onChange={setFormat}>
            {["mp3", "wav", "flac", "m4a"].map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
          </Select></div>
          <Button variant="primary" onClick={pick}><Music size={16} />Choose files</Button>
        </div>
        <p className="text-xs text-muted mt-4">A song can take a few minutes, depending on your computer. Only use music you have the right to edit.</p>
      </Card>

      {[...jobs].reverse().map((j) => {
        const done = ["completed", "failed", "canceled"].includes(j.status);
        return (
          <Card key={j.id} className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <MicVocal size={18} className="text-accent shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{j.name}</div>
                <div className="text-xs text-muted flex items-center gap-1.5">
                  {!done && <Loader2 size={12} className="animate-spin" />}
                  {label[j.status]}{!done && j.started_at ? ` ${duration(Math.max(1, now - j.started_at))} elapsed` : ""} · {j.format.toUpperCase()}
                </div>
              </div>
              {done
                ? <IconButton title="Remove" onClick={() => run(api.sepRemove(j.id))}><Trash2 size={16} /></IconButton>
                : <IconButton title="Cancel" onClick={() => run(api.sepCancel(j.id))}><X size={16} /></IconButton>}
            </div>
            {j.error && <div className="flex items-start gap-2 text-sm text-err"><AlertCircle size={15} className="mt-0.5 shrink-0" />{j.error}</div>}
            {j.vocals && j.instrumental && (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => run(api.openFile(j.vocals!))}><MicVocal size={15} />Play vocals</Button>
                <Button onClick={() => run(api.openFile(j.instrumental!))}><Music size={15} />Play instrumental</Button>
                <Button variant="ghost" onClick={() => run(api.revealFile(j.vocals!))}><FolderOpen size={15} />Show in folder</Button>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
