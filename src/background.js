import { extractProductTitle } from "./content/titleExtractor.js";
import { selectRegionAndCrop } from "./content/regionSelector.js";

const MENU_ID      = "auto-save-design-image";
const OFFSCREEN_URL = "src/offscreen.html";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Auto Save Design",
    contexts: ["image", "page"],
  });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  chrome.contextMenus.create(
    { id: MENU_ID, title: "Auto Save Design", contexts: ["image", "page"] },
    () => void chrome.runtime.lastError,
  );
});

// ─────────────────────────────────────────────
// Main flow
// ─────────────────────────────────────────────
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  try {
    const tabId   = tab?.id;
    const frameId = info.frameId ?? 0;
    const pageUrl = info.pageUrl ?? tab?.url ?? "";

    // 1. Resolve image URL
    let srcUrl = info.srcUrl;
    if (!srcUrl) srcUrl = await getImageUrlFromCursor(tabId, frameId);
    if (!srcUrl) {
      sendStatus("❌ Không tìm thấy ảnh — click chuột phải trực tiếp lên ảnh sản phẩm.");
      return;
    }
    console.log("[asd] srcUrl:", srcUrl.slice(0, 120));
    console.log("[asd] pageUrl:", pageUrl.slice(0, 80));

    // 2. Region selector
    sendStatus("✂️ Đang chờ bạn chọn vùng…");
    const titlePromise = extractTitle(tabId, srcUrl, frameId);
    const region = await runRegionSelector(tabId, srcUrl, frameId);
    console.log("[asd] region result:", JSON.stringify(region));

    if (!region) {
      sendStatus("⚠️ Lỗi vùng chọn — thử lại (F12 → Console để xem chi tiết).");
      return;
    }
    if (region.cancelled) { sendStatus(""); return; }
    if (region.error) throw new Error(region.error);

    console.log("[asd] region:", region.cropW, "x", region.cropH, "at", region.cropX, region.cropY);

    // 3. Fetch + crop
    sendStatus("⬇️ Đang tải ảnh…");
    const croppedBlob = await fetchAndCropMultiStrategy(srcUrl, region, tabId, frameId, pageUrl);
    const imageDataUrl = await blobToDataUrl(croppedBlob);
    console.log("[asd] cropped blob:", croppedBlob.size, "bytes");

    // 4. Process (remove bg + compose)
    sendStatus("🎨 Đang xử lý ảnh…");
    const title = await titlePromise;
    const {
      subfolder      = "auto-save-design",
      bgMethod       = "chroma",
      rembgUrl       = "http://localhost:7000",
      hfToken        = "",
      walmartEnabled = false,
      walmartUrl     = "http://localhost:5000",
      designTone     = "auto",
    } = await chrome.storage.local.get([
      "subfolder", "bgMethod", "rembgUrl", "hfToken",
      "walmartEnabled", "walmartUrl", "designTone",
    ]);

    await ensureOffscreen();
    // Small delay to ensure offscreen message listener is ready
    await new Promise(r => setTimeout(r, 50));
    chrome.runtime.sendMessage({
      target: "offscreen",
      type:   "PROCESS_IMAGE",
      payload: {
        url: srcUrl, pageUrl, title, imageDataUrl,
        subfolder, bgMethod, rembgUrl, hfToken,
        walmartEnabled, walmartUrl, designTone,
      },
    }).catch(() => {});
  } catch (err) {
    console.error("[asd] error:", err);
    sendStatus("❌ Lỗi: " + (err?.message ?? String(err)));
  }
});

// ─────────────────────────────────────────────
// Fetch + crop — nhiều strategy
// ─────────────────────────────────────────────
async function fetchAndCropMultiStrategy(url, region, tabId, frameId, pageUrl) {
  const { cropX: sx, cropY: sy, cropW: sw, cropH: sh } = region;

  // Referer = trang đang mở (không phải CDN) để bypass kiểm tra hotlink
  let referer = "";
  try {
    referer = pageUrl ? new URL(pageUrl).origin + "/" : new URL(url).origin + "/";
  } catch { referer = ""; }

  // Strategy 1: SW fetch với Referer của trang (host_permissions bypass CORS)
  console.log("[asd] Strategy 1: SW fetch, referer:", referer);
  try {
    const blob = await swFetchWithTimeout(url, 12000, referer);
    if (blob) {
      console.log("[asd] Strategy 1 OK:", blob.size, "bytes");
      return await cropBlob(blob, sx, sy, sw, sh);
    }
  } catch (e) {
    console.warn("[asd] Strategy 1 failed:", e.message);
  }

  // Strategy 2: Page-context fetch (có Referer + cookie đúng — xử lý được Redbubble)
  sendStatus("⬇️ Thử tải qua page context…");
  console.log("[asd] Strategy 2: page-context fetch");
  try {
    const dataUrl = await fetchFromPageContext(url, tabId, frameId);
    if (dataUrl) {
      console.log("[asd] Strategy 2 OK");
      const blob = await (await fetch(dataUrl)).blob();
      return await cropBlob(blob, sx, sy, sw, sh);
    }
  } catch (e) {
    console.warn("[asd] Strategy 2 failed:", e.message);
  }

  // Strategy 3: Canvas từ img element đã render sẵn (không cần fetch)
  sendStatus("⬇️ Đọc trực tiếp từ canvas trang…");
  console.log("[asd] Strategy 3: canvas capture");
  try {
    const dataUrl = await captureFromRenderedImg(url, region, tabId, frameId);
    if (dataUrl) {
      console.log("[asd] Strategy 3 OK");
      const blob = await (await fetch(dataUrl)).blob();
      return blob; // already cropped
    }
  } catch (e) {
    console.warn("[asd] Strategy 3 failed:", e.message);
  }

  throw new Error(`Không thể tải ảnh từ: ${new URL(url).hostname}. Mở Console (F12) để xem chi tiết.`);
}

async function swFetchWithTimeout(url, timeoutMs, referer) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = {};
    if (referer) headers["Referer"] = referer;
    const res = await fetch(url, {
      credentials: "omit",
      headers,
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (blob.size < 512) throw new Error("Blob quá nhỏ — CDN có thể đang chặn");
    return blob;
  } finally {
    clearTimeout(timer);
  }
}

// Fetch từ page context (MAIN world) — có Referer + cookie
async function fetchFromPageContext(url, tabId, frameId) {
  if (!tabId) return null;
  const out = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world: "MAIN",
    func: async (imgUrl) => {
      async function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload  = () => resolve(r.result);
          r.onerror = () => reject(r.error);
          r.readAsDataURL(blob);
        });
      }
      try {
        const res = await fetch(imgUrl, { credentials: "include" });
        if (res.ok) {
          const blob = await res.blob();
          if (blob.size > 1024 && blob.type.startsWith("image/"))
            return await blobToDataUrl(blob);
        }
      } catch {}
      return null;
    },
    args: [url],
  });
  return out?.[0]?.result ?? null;
}

// Lấy pixel từ <img> đã render sẵn — không cần fetch mạng
async function captureFromRenderedImg(url, region, tabId, frameId) {
  if (!tabId) return null;
  const { cropX, cropY, cropW, cropH } = region;
  const out = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world: "MAIN",
    func: (imgUrl, sx, sy, sw, sh) => {
      const img =
        [...document.images].find(i => i.currentSrc === imgUrl || i.src === imgUrl) ||
        [...document.images].filter(i => i.naturalWidth > 100)
          .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)[0];
      if (!img || !img.naturalWidth) return null;
      const x = Math.max(0, Math.min(sx, img.naturalWidth  - 1));
      const y = Math.max(0, Math.min(sy, img.naturalHeight - 1));
      const w = Math.max(1, Math.min(sw, img.naturalWidth  - x));
      const h = Math.max(1, Math.min(sh, img.naturalHeight - y));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      try {
        c.getContext("2d").drawImage(img, x, y, w, h, 0, 0, w, h);
        return c.toDataURL("image/png");
      } catch {
        return null;
      }
    },
    args: [url, cropX, cropY, cropW, cropH],
  });
  return out?.[0]?.result ?? null;
}

async function cropBlob(blob, sx, sy, sw, sh) {
  const img = await createImageBitmap(blob);
  const x = Math.max(0, Math.min(sx, img.width  - 1));
  const y = Math.max(0, Math.min(sy, img.height - 1));
  const w = Math.max(1, Math.min(sw, img.width  - x));
  const h = Math.max(1, Math.min(sh, img.height - y));
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d").drawImage(img, x, y, w, h, 0, 0, w, h);
  img.close?.();
  return await canvas.convertToBlob({ type: "image/png" });
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
async function blobToDataUrl(blob) {
  const buf   = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let binary  = "";
  for (let i = 0; i < bytes.length; i += CHUNK)
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return `data:${blob.type};base64,${btoa(binary)}`;
}

async function getImageUrlFromCursor(tabId, frameId) {
  if (typeof tabId !== "number") return null;
  try {
    const out = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: () => window.__asdContextImg?.url || null,
      world: "MAIN",
    });
    return out?.[0]?.result || null;
  } catch { return null; }
}

async function runRegionSelector(tabId, srcUrl, frameId) {
  if (typeof tabId !== "number") return null;
  try {
    const out = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: selectRegionAndCrop,
      args: [srcUrl],
      world: "MAIN",
    });
    return out?.[0]?.result ?? null;
  } catch (err) {
    console.warn("[asd] region selector executeScript failed:", err?.message ?? err);
    return null;
  }
}

async function extractTitle(tabId, srcUrl, frameId) {
  if (typeof tabId !== "number") return "";
  try {
    const out = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: extractProductTitle,
      args: [srcUrl],
      world: "MAIN",
    });
    return out?.[0]?.result ?? "";
  } catch { return ""; }
}

// Gửi status lên sidepanel
function sendStatus(message) {
  chrome.runtime.sendMessage({ target: "popup", type: "STATUS", payload: { message } })
    .catch(() => {});
}

// ─────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== "background") return false;
  if (msg.type === "RESULT") {
    const { ok, filename, error } = msg.payload ?? {};
    sendStatus(ok ? `✅ Đã lưu: ${filename}` : `❌ ${error ?? "Lỗi không xác định"}`);
    return false;
  }
  if (msg.type === "DOWNLOAD") {
    const { dataUrl, filename } = msg.payload ?? {};
    chrome.downloads.download({ url: dataUrl, filename, saveAs: false })
      .then(id => sendResponse({ ok: true, downloadId: id }))
      .catch(e => sendResponse({ ok: false, error: e?.message ?? String(e) }));
    return true;
  }
  return false;
});

// ─────────────────────────────────────────────
// Offscreen
// ─────────────────────────────────────────────
async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["DOM_PARSER", "BLOBS", "WORKERS"],
    justification: "Run OffscreenCanvas compositing and PNG encoding for print-ready output.",
  });
}

async function hasOffscreen() {
  if (!chrome.runtime.getContexts) return false;
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  return contexts.length > 0;
}
