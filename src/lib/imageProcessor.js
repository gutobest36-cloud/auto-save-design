import { removeColorBackground }    from "./colorRemove.js";
import { removeBackgroundRembg, removeBackgroundHF } from "./rembgClient.js";
import { composeOnCanvas }           from "./compose.js";

/**
 * Pipeline:
 *   1. Remove background (chroma / rembg local / HF RMBG-1.4)
 *   2. Bicubic resize cutout → print target size
 *   3. Compose centered on transparent canvas (canvasWidth × canvasHeight)
 */
export async function processImage(sourceBlob, opts) {
  const {
    canvasWidth,
    canvasHeight,
    onStatus,
    bgMethod  = "chroma",
    rembgUrl  = "http://localhost:7000",
    hfToken   = "",
  } = opts;

  const sourceBitmap = await createImageBitmap(sourceBlob);
  const { width: w0, height: h0 } = sourceBitmap;
  console.log("[asd] source:", w0, "x", h0, "| method:", bgMethod);

  // Layout: fit design vào canvas giữ tỉ lệ
  const widthFitH  = Math.round((h0 * canvasWidth) / w0);
  const useWidthFit = widthFitH <= canvasHeight;
  const targetWidth  = useWidthFit ? canvasWidth  : Math.round((w0 * canvasHeight) / h0);
  const targetHeight = useWidthFit ? widthFitH    : canvasHeight;
  console.log("[asd] target:", targetWidth, "x", targetHeight);

  // ── 1. Remove background ──
  let cutoutBlob;

  if (bgMethod === "hf") {
    onStatus?.("🤖 Đang gửi lên HF RMBG-1.4…");
    try {
      cutoutBlob = await removeBackgroundHF(sourceBlob, hfToken);
      console.log("[asd] HF cutout:", cutoutBlob.size, "bytes");
    } catch (err) {
      console.warn("[asd] HF failed, fallback chroma:", err);
      onStatus?.(`⚠️ HF thất bại (${err.message}), dùng chroma-key…`);
      cutoutBlob = await removeColorBackground(await createImageBitmap(sourceBlob));
    }

  } else if (bgMethod === "rembg") {
    onStatus?.("🐍 Đang gửi lên rembg server…");
    try {
      cutoutBlob = await removeBackgroundRembg(sourceBlob, rembgUrl);
      console.log("[asd] rembg cutout:", cutoutBlob.size, "bytes");
    } catch (err) {
      console.warn("[asd] rembg failed, fallback chroma:", err);
      onStatus?.(`⚠️ rembg thất bại (${err.message}), dùng chroma-key…`);
      cutoutBlob = await removeColorBackground(await createImageBitmap(sourceBlob));
    }

  } else {
    onStatus?.("🎨 Chroma-key xóa nền…");
    cutoutBlob = await removeColorBackground(sourceBitmap);
    console.log("[asd] chroma cutout:", cutoutBlob.size, "bytes");
  }

  sourceBitmap.close?.();

  // ── 2. Scale lên kích thước print ──
  onStatus?.(`📐 Scale ${targetWidth}×${targetHeight}…`);
  const cutoutBitmap = await createImageBitmap(cutoutBlob);
  const scaledBitmap = await scaleBitmap(cutoutBitmap, targetWidth, targetHeight);
  cutoutBitmap.close?.();

  // ── 3. Compose lên canvas trong suốt ──
  onStatus?.("🖼️ Đặt lên canvas…");
  const finalBlob = await composeOnCanvas(scaledBitmap, {
    canvasWidth,
    canvasHeight,
    targetWidth,
    targetHeight,
  });
  scaledBitmap.close?.();

  return finalBlob;
}

async function scaleBitmap(bitmap, w, h) {
  const c   = new OffscreenCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  return await c.transferToImageBitmap();
}
