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
}

function status(message) {
  try {
    chrome.runtime.sendMessage({
      target: "background",
      type: "STATUS",
      payload: { message },
    });
  } catch {
    /* popup may be closed */
  }
  // Also broadcast to popup directly.
  try {
    chrome.runtime.sendMessage({
      target: "popup",
      type: "STATUS",
      payload: { message },
    });
  } catch {
    /* noop */
  }
}

function report(payload) {
  chrome.runtime.sendMessage({ target: "background", type: "RESULT", payload });
  chrome.runtime.sendMessage({ target: "popup", type: "RESULT", payload });
}
