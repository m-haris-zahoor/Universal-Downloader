import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ClipboardPaste, Clock, Download, Film, Loader2, Music, Search, Sparkles, User } from "lucide-react";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { api, errMsg, type MediaInfo, type Settings } from "../services/api";
import { AUDIO_BITRATES, AUDIO_FORMATS, VIDEO_FORMATS, availablePresets, bytes, duration, heightLabel, isUrl } from "../services/format";
import { Button, Card, Select, Thumb } from "../components/ui";

export function Home({ settings, clip, clearClip, toast, goQueue }: {
  settings: Settings; clip: string | null; clearClip: () => void; toast: (m: string, t?: "ok" | "err") => void; goQueue: () => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"video" | "audio">("video");
  const [quality, setQuality] = useState("best");
  const [vfmt, setVfmt] = useState(settings.video_format);
  const [afmt, setAfmt] = useState(settings.audio_format);
  const [abr, setAbr] = useState(settings.audio_quality);
  const [hq, setHq] = useState(settings.prefer_hq);

  const presets = useMemo(() => availablePresets(info?.heights.map((h) => h.height) ?? []), [info]);

  async function analyze(u = url) {
    const target = u.trim();
    if (!isUrl(target)) { setError("Enter a valid http(s) URL."); return; }
    setBusy(true); setError(null); setInfo(null);
    try {
      const r = await api.analyze(target);
      setInfo(r);
      const k = r.has_video ? "video" : "audio";
      setKind(k);
      const want = settings.video_quality === "best" ? Infinity : Number(settings.video_quality);
      const ok = availablePresets(r.heights.map((h) => h.height)).filter((p) => p.enabled && p.value <= want);
      setQuality(ok.length && want !== Infinity ? String(ok[ok.length - 1].value) : "best");
      setVfmt(settings.video_format); setAfmt(settings.audio_format); setAbr(settings.audio_quality); setHq(settings.prefer_hq);
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  useEffect(() => { setVfmt(settings.video_format); setAfmt(settings.audio_format); setAbr(settings.audio_quality); }, [settings]);

  async function paste() {
    try { const t = (await readText()).trim(); if (t) { setUrl(t); analyze(t); } else toast("Clipboard is empty.", "err"); }
    catch { toast("Couldn't read the clipboard.", "err"); }
  }

  const estSize = useMemo(() => {
    if (!info) return null;
    if (kind === "video") {
      const hs = info.heights.filter((h) => quality === "best" || h.height <= Number(quality));
      return hs.length ? hs[hs.length - 1].size : info.video_size;
    }
    const d = info.duration;
    if (abr !== "best" && d && ["mp3", "m4a", "opus"].includes(afmt)) return (Number(abr) * 1000 / 8) * d;
    if (afmt === "wav" && d) return 176400 * d;
    if (abr === "best" && ["m4a", "opus"].includes(afmt)) return info.audio_size;
    return null;
  }, [info, kind, quality, afmt, abr]);

  async function download() {
    if (!info) return;
    try {
      await api.enqueue({
        url: info.url, title: info.title, thumbnail: info.thumbnail, platform: info.platform, kind,
        height: kind === "video" && quality !== "best" ? Number(quality) : null,
        container: vfmt, audio_format: afmt,
        audio_bitrate: kind === "audio" && abr !== "best" && ["mp3", "m4a", "opus"].includes(afmt) ? Number(abr) : null,
        est_size: estSize ? Math.round(estSize) : null, hq,
      });
      toast("Added to queue"); goQueue();
    } catch (e) { toast(errMsg(e), "err"); }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Download media</h1>
        <p className="text-muted mt-1">Paste a link from YouTube, Instagram, TikTok, X, Reddit, Vimeo and more.</p>
      </div>

      <AnimatePresence>
        {clip && !info && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex items-center gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-2.5 text-sm">
            <ClipboardPaste size={16} className="text-accent shrink-0" />
            <span className="truncate flex-1 text-muted">Link in clipboard: <span className="text-fg">{clip}</span></span>
            <Button variant="ghost" className="h-8" onClick={clearClip}>Dismiss</Button>
            <Button variant="primary" className="h-8" onClick={() => { setUrl(clip); clearClip(); analyze(clip); }}>Use link</Button>
          </motion.div>
        )}
      </AnimatePresence>

      <Card className="p-2 flex gap-2 items-center">
        <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && analyze()}
          placeholder="https://…" spellCheck={false}
          className="flex-1 h-10 bg-transparent px-3 outline-none placeholder:text-muted/70" />
        <Button onClick={paste}><ClipboardPaste size={16} />Paste</Button>
        <Button variant="primary" onClick={() => analyze()} disabled={busy || !url.trim()}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}Analyze
        </Button>
      </Card>

      {error && <div className="rounded-xl border border-err/40 bg-err/10 text-err px-4 py-3 text-sm">{error}</div>}

      <AnimatePresence mode="wait">
        {info && (
          <motion.div key={info.url} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <Card className="p-5 space-y-5">
              <div className="flex gap-4">
                <Thumb src={info.thumbnail} className="w-48 aspect-video rounded-xl shrink-0" />
                <div className="min-w-0 space-y-2">
                  <div className="font-medium leading-snug line-clamp-2">{info.title}</div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    <span className="inline-flex items-center gap-1"><Clock size={13} />{duration(info.duration)}</span>
                    {info.uploader && <span className="inline-flex items-center gap-1"><User size={13} />{info.uploader}</span>}
                    <span className="rounded-md bg-surface2 border border-line px-1.5">{info.platform}</span>
                  </div>
                </div>
              </div>

              <div className="inline-flex rounded-xl bg-surface2 border border-line p-1">
                {([["video", Film, info.has_video], ["audio", Music, info.has_audio]] as const).map(([k, Icon, ok]) => (
                  <button key={k} disabled={!ok} onClick={() => setKind(k)}
                    className={`relative px-4 h-8 rounded-lg text-sm inline-flex items-center gap-2 transition cursor-pointer disabled:opacity-40 disabled:pointer-events-none ${kind === k ? "bg-accent text-accentfg font-medium" : "text-muted hover:text-fg"}`}>
                    <Icon size={15} />{k === "video" ? "Video" : "Audio"}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-4">
                {kind === "video" ? (<>
                  <Select label="Quality" value={quality} onChange={setQuality} disabled={!info.heights.length}>
                    <option value="best">Best available{info.heights.length ? ` (${info.heights[info.heights.length - 1].height}p)` : ""}</option>
                    {presets.map((p) => <option key={p.value} value={p.value} disabled={!p.enabled}>{heightLabel(p.value)}{p.enabled ? "" : " — not available"}</option>)}
                  </Select>
                  <Select label="Format" value={vfmt} onChange={setVfmt}>
                    {VIDEO_FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
                  </Select>
                </>) : (<>
                  <Select label="Quality" value={abr} onChange={setAbr} disabled={["wav", "flac"].includes(afmt)}>
                    <option value="best">Original / Best{info.audio_abr ? ` (~${Math.round(info.audio_abr)} kbps)` : ""}</option>
                    {AUDIO_BITRATES.map((b) => <option key={b} value={b}>{b} kbps</option>)}
                  </Select>
                  <Select label="Format" value={afmt} onChange={setAfmt}>
                    {AUDIO_FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
                  </Select>
                </>)}
              </div>
              {kind === "video" && (
                <label className="flex items-start gap-3 rounded-xl bg-surface2 border border-line px-4 py-3 cursor-pointer -mt-1">
                  <input type="checkbox" checked={hq} onChange={(e) => setHq(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
                  <span><span className="flex items-center gap-1.5 font-medium"><Sparkles size={14} className="text-accent" />High quality mode</span>
                  <span className="text-xs text-muted block mt-0.5">Picks the highest-bitrate source streams (VP9/AV1 when offered). Best fidelity; MKV is the most compatible container for these.</span></span>
                </label>
              )}
              {kind === "audio" && ["wav", "flac"].includes(afmt) && <p className="text-xs text-muted -mt-2">Lossless containers keep the source's quality; they don't improve a lossy source.</p>}
              {kind === "video" && !info.heights.length && <p className="text-xs text-muted -mt-2">Resolution isn't reported for this source; the best stream will be downloaded.</p>}

              <div className="flex items-center justify-between pt-1">
                <div className="text-sm text-muted">Estimated size <span className="text-fg font-medium ml-1">{estSize ? `~${bytes(estSize)}` : "Unknown"}</span></div>
                <Button variant="primary" onClick={download}><Download size={16} />Download</Button>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
