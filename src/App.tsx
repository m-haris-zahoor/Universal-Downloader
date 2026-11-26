import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { api, errMsg, type Job, type Settings } from "./services/api";
import { isUrl } from "./services/format";
import { Sidebar, type Page } from "./components/Sidebar";
import { Home } from "./pages/Home";
import { Queue } from "./pages/Queue";
import { Vocals } from "./pages/Vocals";
import { HistoryPage } from "./pages/History";
import { SettingsPage } from "./pages/Settings";

export default function App() {
  const [page, setPage] = useState<Page>("home");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [histVer, setHistVer] = useState(0);
  const [clip, setClip] = useState<string | null>(null);
  const [toast, setToast] = useState<{ m: string; t: "ok" | "err" } | null>(null);
  const lastClip = useRef("");
  const settingsRef = useRef<Settings | null>(null);
  settingsRef.current = settings;

  const showToast = useCallback((m: string, t: "ok" | "err" = "ok") => {
    setToast({ m, t });
    setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    api.getSettings().then(setSettings);
    api.listJobs().then(setJobs);
    const subs = [api.onQueue(setJobs), api.onHistory(() => setHistVer((v) => v + 1))];
    return () => { subs.forEach((p) => p.then((u) => u())); };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("light", settings?.theme === "light");
  }, [settings?.theme]);

  // Clipboard URL detection on window focus.
  useEffect(() => {
    const check = async () => {
      if (!settingsRef.current?.clipboard_detect) return;
      try {
        const t = (await readText()).trim();
        if (t && t !== lastClip.current && isUrl(t)) { lastClip.current = t; setClip(t); }
      } catch { /* clipboard unavailable */ }
    };
    check();
    const un = getCurrentWindow().onFocusChanged(({ payload }) => payload && check());
    return () => { un.then((u) => u()); };
  }, [settings !== null]);

  const update = async (s: Settings) => {
    try { setSettings(await api.saveSettings(s)); } catch (e) { showToast(errMsg(e), "err"); }
  };

  if (!settings) return null;
  const active = jobs.filter((j) => ["queued", "downloading", "processing", "paused"].includes(j.status)).length;

  return (
    <div className="h-full flex">
      <Sidebar page={page} setPage={setPage} active={active} />
      <main className="flex-1 overflow-y-auto p-8">
        <AnimatePresence mode="wait">
          <motion.div key={page} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            {page === "home" && <Home settings={settings} clip={clip} clearClip={() => setClip(null)} toast={showToast} goQueue={() => setPage("queue")} />}
            {page === "queue" && <Queue jobs={jobs} />}
            {page === "vocals" && <Vocals toast={showToast} />}
            {page === "history" && <HistoryPage version={histVer} toast={showToast} />}
            {page === "settings" && <SettingsPage settings={settings} update={update} toast={showToast} />}
          </motion.div>
        </AnimatePresence>
      </main>
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className={`fixed bottom-6 right-6 rounded-xl border px-4 py-2.5 text-sm bg-surface ${toast.t === "err" ? "border-err/50 text-err" : "border-line"}`}>
            {toast.m}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
