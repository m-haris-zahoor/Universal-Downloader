import { useEffect, useState } from "react";
import { FileX, FolderOpen, History as H, Play, Trash2 } from "lucide-react";
import { api, errMsg, type HistoryItem } from "../services/api";
import { bytes, date } from "../services/format";
import { Card, Empty, IconButton, Thumb } from "../components/ui";

export function HistoryPage({ version, toast }: { version: number; toast: (m: string, t?: "ok" | "err") => void }) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const load = () => api.history().then(setItems).catch((e) => toast(errMsg(e), "err"));
  useEffect(() => { load(); }, [version]);
  const run = (p: Promise<unknown>) => p.catch((e) => toast(errMsg(e), "err"));

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">History</h1>
      {items.length === 0 && <Empty icon={<H size={22} />} title="Nothing here yet" hint="Completed downloads appear here." />}
      {items.map((h) => (
        <Card key={h.id} className="p-4 flex gap-4 items-center">
          <Thumb src={h.thumbnail} className="w-28 aspect-video rounded-lg shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{h.title}</div>
            <div className="text-xs text-muted truncate mt-0.5">{h.file_path.split(/[\\/]/).pop()}</div>
            <div className="flex flex-wrap gap-x-3 text-xs text-muted mt-1.5">
              <span>{h.resolution}</span><span>{h.format}</span><span>{bytes(h.size)}</span><span>{date(h.created_at)}</span>
              {!h.exists && <span className="text-warn inline-flex items-center gap-1"><FileX size={12} />File missing</span>}
            </div>
          </div>
          <div className="flex shrink-0">
            <IconButton title="Open file" disabled={!h.exists} onClick={() => run(api.openFile(h.file_path))}><Play size={16} /></IconButton>
            <IconButton title="Show in folder" disabled={!h.exists} onClick={() => run(api.revealFile(h.file_path))}><FolderOpen size={16} /></IconButton>
            <IconButton title="Remove from history" onClick={() => run(api.deleteHistory(h.id).then(load))}><Trash2 size={16} /></IconButton>
          </div>
        </Card>
      ))}
    </div>
  );
}
