import { AlertCircle, Check, ListChecks, Pause, Play, RotateCcw, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { api, type Job } from "../services/api";
import { bytes, eta, speed } from "../services/format";
import { Button, Card, Empty, IconButton, Progress, Thumb } from "../components/ui";

const label: Record<Job["status"], string> = {
  queued: "Queued", downloading: "Downloading", processing: "Processing…", paused: "Paused",
  completed: "Completed", failed: "Failed", canceled: "Canceled",
};

export function Queue({ jobs }: { jobs: Job[] }) {
  const done = jobs.some((j) => ["completed", "failed", "canceled"].includes(j.status));
  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-end justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Queue</h1>
        {done && <Button variant="ghost" onClick={() => api.removeJobs()}><Trash2 size={15} />Clear finished</Button>}
      </div>
      {jobs.length === 0 && <Empty icon={<ListChecks size={22} />} title="No downloads yet" hint="Analyze a link on Home to add one." />}
      <AnimatePresence initial={false}>
        {[...jobs].reverse().map((j) => {
          const live = j.status === "downloading" || j.status === "processing";
          const finished = ["completed", "failed", "canceled"].includes(j.status);
          return (
            <motion.div key={j.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}>
              <Card className="p-4 flex gap-4">
                <Thumb src={j.req.thumbnail} className="w-28 aspect-video rounded-lg shrink-0" />
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{j.req.title}</div>
                      <div className="text-xs text-muted">
                        {j.req.kind === "video" ? `${j.req.height ? j.req.height + "p" : "Best"} · ${j.req.container.toUpperCase()}` : `${j.req.audio_format.toUpperCase()} · ${j.req.audio_bitrate ? j.req.audio_bitrate + " kbps" : "Original"}`}
                        {" · "}{j.req.platform}
                      </div>
                    </div>
                    <div className="flex">
                      {live && <IconButton title="Pause" onClick={() => api.jobControl(j.id, "pause")}><Pause size={16} /></IconButton>}
                      {j.status === "paused" && <IconButton title="Resume" onClick={() => api.jobControl(j.id, "resume")}><Play size={16} /></IconButton>}
                      {(j.status === "failed" || j.status === "canceled") && <IconButton title="Retry" onClick={() => api.jobControl(j.id, "retry")}><RotateCcw size={16} /></IconButton>}
                      {!finished && <IconButton title="Cancel" onClick={() => api.jobControl(j.id, "cancel")}><X size={16} /></IconButton>}
                      {finished && <IconButton title="Remove" onClick={() => api.removeJobs(j.id)}><Trash2 size={16} /></IconButton>}
                    </div>
                  </div>
                  {j.status === "failed" ? (
                    <div className="flex items-start gap-2 text-sm text-err"><AlertCircle size={15} className="mt-0.5 shrink-0" /><span>{j.error}</span></div>
                  ) : j.status === "completed" ? (
                    <div className="flex items-center gap-2 text-sm text-ok"><Check size={15} />Saved · {bytes(j.total)}</div>
                  ) : (<>
                    <Progress value={j.percent} tone={j.status === "paused" ? "warn" : "accent"} />
                    <div className="flex gap-4 text-xs text-muted">
                      <span className="text-fg">{label[j.status]}</span>
                      {j.status !== "queued" && <span>{j.percent.toFixed(1)}%</span>}
                      {j.status === "downloading" && <><span>{speed(j.speed)}</span><span>ETA {eta(j.eta)}</span></>}
                      {j.total ? <span className="ml-auto">{bytes(j.downloaded)} / ~{bytes(j.total)}</span> : null}
                    </div>
                  </>)}
                </div>
              </Card>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
