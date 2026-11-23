// Shows a "Download" button over the video under the pointer (like IDM).
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  let btn, hideTimer, current;

  function ensure() {
    if (btn) return btn;
    btn = document.createElement("button");
    btn.textContent = "⬇ Download";
    Object.assign(btn.style, {
      position: "fixed", zIndex: 2147483647, display: "none", padding: "6px 12px", border: "1px solid rgba(255,255,255,.25)",
      borderRadius: "10px", background: "rgba(20,22,27,.92)", color: "#fff", font: "600 13px system-ui, sans-serif",
      cursor: "pointer", boxShadow: "0 4px 16px rgba(0,0,0,.4)",
    });
    btn.addEventListener("click", async (e) => {
      e.preventDefault(); e.stopPropagation();
      btn.textContent = "Sending…";
      try {
        const res = await api.runtime.sendMessage({ type: "download", url: location.href, src: current?.currentSrc, kind: "video" });
        btn.textContent = res?.ok ? "✓ Added to queue" : "⚠ " + (res?.error || "Failed");
      } catch { btn.textContent = "⚠ Extension error"; }
      setTimeout(() => { btn.textContent = "⬇ Download"; }, 2800);
    });
    document.documentElement.appendChild(btn);
    return btn;
  }

  let last = 0;
  document.addEventListener("mousemove", (e) => {
    const now = Date.now();
    if (now - last < 120) return; last = now;
    const vid = [...document.querySelectorAll("video")].find((v) => {
      const r = v.getBoundingClientRect();
      return r.width > 240 && r.height > 140 && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    });
    if (!vid) return;
    current = vid;
    const r = vid.getBoundingClientRect();
    const b = ensure();
    b.style.display = "block";
    b.style.left = Math.max(8, Math.min(r.right - 130, innerWidth - 150)) + "px";
    b.style.top = Math.max(8, r.top + 10) + "px";
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (btn) btn.style.display = "none"; }, 2500);
  }, { passive: true });
})();
