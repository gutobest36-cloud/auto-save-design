import { processImage } from "./lib/imageProcessor.js";
import { saveBlob } from "./lib/fileSystem.js";
import { buildFilename } from "./lib/filename.js";

const CANVAS_W = 4200;
const CANVAS_H = 4800;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== "offscreen") return false;
  if (msg.type === "PROCESS_IMAGE") {
    handleProcess(msg.payload).catch((err) => {
      report({ ok: false, error: err?.message ?? String(err) });
    });
  }
  return false;
});

async function handleProcess({
  url,
  pageUrl,
  title,
  imageDataUrl,
  subfolder,
  bgMethod,
  rembgUrl,
  hfToken,
  walmartEnabled,
  walmartUrl,
  designTone,
}) {
  if (!imageDataUrl || !imageDataUrl.startsWith("data:")) {
    throw new Error("[v4 offscreen] Missing imageDataUrl from background");
  }
  console.log(
    "[auto-save-design v4 offscreen] received dataURL length:",
    imageDataUrl.length,
  );
  const sourceBlob = await (await fetch(imageDataUrl)).blob();
  console.log(
    "[auto-save-design v4 offscreen] decoded blob:",
    sourceBlob.size,
    sourceBlob.type,
  );
  if (sourceBlob.size < 1024) {
    const tail = url.length > 80 ? "…" + url.slice(-70) : url;
    throw new Error(
      `[v4 offscreen] Tiny blob ${sourceBlob.size}B (${sourceBlob.type}). URL: ${tail}`,
    );
  }
  try {
    const probe = await createImageBitmap(sourceBlob);
    probe.close?.();
  } catch (e) {
    throw new Error(
      `[v4] Decode failed (${sourceBlob.size}B, ${sourceBlob.type || "unknown"}): ${e?.message ?? e}`,
    );
  }

  status("Removing background…");
  const cutoutBlob = await processImage(sourceBlob, {
    canvasWidth: CANVAS_W,
    canvasHeight: CANVAS_H,
    onStatus: status,
    bgMethod: bgMethod ?? "chroma",
    rembgUrl: rembgUrl ?? "http://localhost:7000",
    hfToken:  hfToken  ?? "",
  });

  status("Saving file…");
  const filename = buildFilename(title, { pageUrl, srcUrl: url });
  const saved = await saveBlob(cutoutBlob, filename, subfolder);

  report({ ok: true, filename: saved });

  // ── Walmart Tool integration — fire-and-forget, không block luồng chính ──
  if (walmartEnabled && walmartUrl) {
    sendToWalmartTool(cutoutBlob, title, saved, walmartUrl, designTone).catch(() => {});
  }
}

// ─────────────────────────────────────────────
// Walmart Tool integration
// ─────────────────────────────────────────────
async function sendToWalmartTool(blob, title, filename, walmartUrl, designTone) {
  status("🛒 Đang gửi sang Walmart tool...");
  const form = new FormData();
  form.append("file", new File([blob], filename, { type: "image/png" }));
  form.append("title", title || "");
  form.append("design_tone", designTone || "auto");

  let res;
  try {
    res = await fetch(`${walmartUrl}/api/auto-ingest`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(10000), // chỉ chờ ACK, Flask trả về ngay
    });
  } catch (err) {
    status(`⚠️ Walmart tool: lỗi kết nối — ${err?.message ?? err}`);
    return;
  }

  if (!res.ok) {
    status(`⚠️ Walmart tool: server trả lỗi ${res.status}`);
    return;
  }

  let json;
  try {
    json = await res.json();
  } catch {
    status("⚠️ Walmart tool: phản hồi không hợp lệ");
    return;
  }

  if (json.queued) {
    const toneLabel = { dark: "áo sáng", light: "áo tối", both: "tất cả màu" };
    const hint = json.detected_tone ? ` [${toneLabel[json.detected_tone] ?? json.detected_tone}]` : "";
    status(`🛒 Walmart: "${json.keyword}"${hint} đang xử lý — mở localhost:5000 để theo dõi`);
  } else if (json.error) {
    status(`⚠️ Walmart tool lỗi: ${json.error}`);
  }
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function status(message) {
  chrome.runtime.sendMessage({
    target: "background",
    type: "STATUS",
    payload: { message },
  }).catch(() => {});
  chrome.runtime.sendMessage({
    target: "popup",
    type: "STATUS",
    payload: { message },
  }).catch(() => {});
}

function report(payload) {
  chrome.runtime.sendMessage({ target: "background", type: "RESULT", payload }).catch(() => {});
  chrome.runtime.sendMessage({ target: "popup",      type: "RESULT", payload }).catch(() => {});
}
