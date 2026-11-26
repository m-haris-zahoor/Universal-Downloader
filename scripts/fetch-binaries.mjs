// Downloads Windows yt-dlp, ffmpeg and ffprobe into src-tauri/resources/bin (run in CI before `tauri build`).
import { mkdirSync, writeFileSync, existsSync, readdirSync, copyFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const bin = "src-tauri/resources/bin";
mkdirSync(bin, { recursive: true });
const get = async (url, dest) => {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
};
await get("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe", join(bin, "yt-dlp.exe"));
await get("https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip", "ffmpeg.zip");
execSync("tar -xf ffmpeg.zip -C .", { stdio: "inherit" });
const dir = readdirSync(".").find((d) => d.startsWith("ffmpeg-master-latest-win64-gpl") && !d.endsWith(".zip"));
for (const f of ["ffmpeg.exe", "ffprobe.exe"]) copyFileSync(join(dir, "bin", f), join(bin, f));
rmSync("ffmpeg.zip"); rmSync(dir, { recursive: true });
console.log(readdirSync(bin));

// Vocal separation: sherpa-onnx engine + UVR-MDX model.
const rel = "https://github.com/k2-fsa/sherpa-onnx/releases/download";
const pkg = "sherpa-onnx-v2.0.3-win-x64-shared-MT-Release-no-tts";
await get(`${rel}/v2.0.3/${pkg}.tar.bz2`, "sherpa.tar.bz2");
execSync("tar -xf sherpa.tar.bz2", { stdio: "inherit" });
copyFileSync(join(pkg, "bin", "sherpa-onnx-offline-source-separation.exe"), join(bin, "separator.exe"));
for (const d of ["bin", "lib"])
  for (const f of readdirSync(join(pkg, d)).filter((f) => f.endsWith(".dll"))) copyFileSync(join(pkg, d, f), join(bin, f));
rmSync("sherpa.tar.bz2"); rmSync(pkg, { recursive: true });
await get(`${rel}/source-separation-models/UVR-MDX-NET-Voc_FT.onnx`, join(bin, "uvr.onnx"));
await get(`${rel}/source-separation-models/UVR-MDX-NET-Inst_HQ_3.onnx`, join(bin, "inst.onnx"));
console.log(readdirSync(bin));
