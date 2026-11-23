import { Download, History, ListChecks, Settings as Cog, ArrowDownToLine } from "lucide-react";
import { motion } from "framer-motion";

export type Page = "home" | "queue" | "history" | "settings";
const items: { id: Page; label: string; icon: typeof Download }[] = [
  { id: "home", label: "Home", icon: Download },
  { id: "queue", label: "Queue", icon: ListChecks },
  { id: "history", label: "History", icon: History },
  { id: "settings", label: "Settings", icon: Cog },
];

export function Sidebar({ page, setPage, active }: { page: Page; setPage: (p: Page) => void; active: number }) {
  return (
    <aside className="w-56 shrink-0 border-r border-line bg-surface/60 p-4 flex flex-col">
      <div className="flex items-center gap-2.5 px-2 py-2 mb-6">
        <div className="h-8 w-8 rounded-xl bg-accent text-accentfg flex items-center justify-center"><ArrowDownToLine size={18} /></div>
        <span className="font-semibold tracking-tight">Downloader</span>
      </div>
      <nav className="space-y-1">
        {items.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setPage(id)}
            className={`relative w-full flex items-center gap-3 px-3 h-10 rounded-xl text-sm transition cursor-pointer ${page === id ? "text-fg" : "text-muted hover:text-fg"}`}>
            {page === id && <motion.span layoutId="nav" className="absolute inset-0 rounded-xl bg-surface2 border border-line" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
            <Icon size={18} className="relative" />
            <span className="relative">{label}</span>
            {id === "queue" && active > 0 && <span className="relative ml-auto text-xs rounded-full bg-accent text-accentfg px-2 py-0.5">{active}</span>}
          </button>
        ))}
      </nav>
    </aside>
  );
}
