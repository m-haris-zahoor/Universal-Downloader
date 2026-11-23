const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
let tab;

(async () => {
  [tab] = await api.tabs.query({ active: true, currentWindow: true });
  $("title").textContent = tab?.url || "";
  const r = await api.runtime.sendMessage({ type: "ping" });
  $("status").className = "dot " + (r?.ok ? "on" : "off");
  $("status").title = r?.ok ? "Desktop app connected" : "Desktop app not running";
  if (!r?.ok) { $("msg").className = "err"; $("msg").textContent = "Open the Universal Downloader app first."; }
})();

async function go(kind) {
  if (!tab?.url || !/^https?:/.test(tab.url)) { $("msg").className = "err"; $("msg").textContent = "This page can't be downloaded."; return; }
  document.querySelectorAll("button").forEach((b) => (b.disabled = true));
  $("msg").className = ""; $("msg").textContent = "Reading media info…";
  const h = $("height").value;
  const res = await api.runtime.sendMessage({ type: "download", url: tab.url, kind, height: h ? Number(h) : undefined });
  $("msg").className = res?.ok ? "ok" : "err";
  $("msg").textContent = res?.ok ? "Added to queue: " + res.title : res?.error || "Failed";
  document.querySelectorAll("button").forEach((b) => (b.disabled = false));
}
$("video").onclick = () => go("video");
$("audio").onclick = () => go("audio");
