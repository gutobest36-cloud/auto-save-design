import Upscaler from "upscaler";
import { x2 as esrganSlimX2 } from "@upscalerjs/esrgan-slim";
import * as tf from "@tensorflow/tfjs";

let upscaler = null;
let aiAvailable = null; // null=untested, true/false after first attempt

function getUpscaler() {
  if (upscaler) return upscaler;
  upscaler = new Upscaler({
    model: esrganSlimX2,
    warmupSizes: [{ patchSize: 64, padding: 2 }],
  });
  return upscaler;
}

/**
 * Upscale a bitmap to `targetWidth`. Tries ESRGAN-slim (AI) first; if the
 * WebGL backend can't compile shaders in this context (a known limitation
 * of some Chrome offscreen docs), falls back to bicubic resize so we
 * always produce *some* output at the requested size.
 */
export async function upscaleToWidth(bitmap, targetWidth, onStatus) {
  if (aiAvailable !== false) {
    try {
      return await aiUpscale(bitmap, targetWidth, onStatus);
    } catch (err) {
      aiAvailable = false;
      console.warn(
        "[auto-save-design] AI upscale failed, falling back to bicubic:",
        err?.message ?? err,
      );
      onStatus?.("AI upscale unavailable — using bicubic");
    }
  }
  return bicubicUpscale(bitmap, targetWidth);
}

async function aiUpscale(bitmap, targetWidth, onStatus) {
  let currentTensor = tf.tidy(() => tf.browser.fromPixels(bitmap));
  let currentW = currentTensor.shape[1];
  let passes = 0;
  const MAX_PASSES = 4;

  while (currentW < targetWidth && passes < MAX_PASSES) {
    passes += 1;
    onStatus?.(`AI upscale pass ${passes}…`);
    let next;
    try {
      next = await getUpscaler().upscale(currentTensor, {
        output: "tensor",
        patchSize: 64,
        padding: 2,
      });
    } catch (err) {
      currentTensor.dispose();
      throw err;
    }
    currentTensor.dispose();
    currentTensor = next;
    currentW = currentTensor.shape[1];
    await new Promise((r) => setTimeout(r, 0));
  }
  if (aiAvailable === null) aiAvailable = true;

  const upCanvas = await tensorToCanvas(currentTensor);
  currentTensor.dispose();

  if (upCanvas.width === targetWidth) return await createImageBitmap(upCanvas);

  // Final bicubic resize down to exactly targetWidth.
  const ratio = targetWidth / upCanvas.width;
  const finalH = Math.round(upCanvas.height * ratio);
  const out = document.createElement("canvas");
  out.width = targetWidth;
  out.height = finalH;
  const ctx = out.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(upCanvas, 0, 0, targetWidth, finalH);
  return await createImageBitmap(out);
}

async function bicubicUpscale(bitmap, targetWidth) {
  const ratio = targetWidth / bitmap.width;
  const finalH = Math.round(bitmap.height * ratio);
  const out = document.createElement("canvas");
  out.width = targetWidth;
  out.height = finalH;
  const ctx = out.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, targetWidth, finalH);
  return await createImageBitmap(out);
}

async function tensorToCanvas(tensor) {
  const [h, w] = tensor.shape;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  await tf.browser.toPixels(tensor, canvas);
  return canvas;
}
