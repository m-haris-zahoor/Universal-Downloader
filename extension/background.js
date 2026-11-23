const api = globalThis.browser ?? globalThis.chrome;
const BASE = "http://127.0.0.1:17893";
const OFFLINE = "Universal Downloader isn't running. Open the desktop app and try again.";

async function ping() {
  try { return (await fetch(BASE + "/ping")).ok; } catch { return false; }
}

async function post(payload) {
  try {
    const r = await fetch(BASE + "/enqueue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    return await r.json();
  } catch { return { ok: false, error: OFFLINE, offline: true }; }
}

async function download({ url, src, kind, height }) {
  let res = await post({ url, kind, height });
  // Fall back to the raw media file when the page URL isn't supported.
  if (!res.ok && !res.offline && src && /^https?:/i.test(src) && src !== url) res = await post({ url: src, kind, height });
  return res;
}

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "ping") ping().then((ok) => sendResponse({ ok }));
  else if (msg.type === "download") download(msg).then(sendResponse);
  else return false;
  return true;
});

function notify(res, tab) {
  // Brief badge feedback on the toolbar icon.
  const text = res.ok ? "✓" : "!";
  api.action.setBadgeText({ text, tabId: tab?.id });
  api.action.setBadgeBackgroundColor({ color: res.ok ? "#16a34a" : "#dc2626" });
  setTimeout(() => api.action.setBadgeText({ text: "", tabId: tab?.id }), 3000);
}

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.removeAll(() => {
    const contexts = ["page", "link", "video", "audio"];
    api.contextMenus.create({ id: "ud-video", title: "Download video with Universal Downloader", contexts });
    api.contextMenus.create({ id: "ud-audio", title: "Download audio with Universal Downloader", contexts });
  });
});

api.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.linkUrl || info.pageUrl || tab?.url;
  const res = await download({ url, src: info.srcUrl, kind: info.menuItemId === "ud-audio" ? "audio" : "video" });
  notify(res, tab);
});
