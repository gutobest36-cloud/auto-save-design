/**
 * Chroma-key style background removal with despill correction.
 *
 * 1. Sample 4 corners (12×12 px each) → median RGB = shirt color.
 * 2. Per-pixel alpha based on Euclidean distance to shirt color.
 * 3. Despill: un-premultiply edge pixels to remove shirt color bleed-through.
 */

const CORNER_SIZE = 12;
const INNER_THRESHOLD = 28;  // distance ≤ this → fully transparent
const OUTER_THRESHOLD = 60;  // distance ≥ this → fully opaque
const MIN_ALPHA_DESPILL = 20; // skip near-transparent pixels in despill (math blows up near 0)

export async function removeColorBackground(sourceBitmap) {
  const w = sourceBitmap.width;
  const h = sourceBitmap.height;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(sourceBitmap, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;

  const shirtColor = estimateCornerColor(data, w, h);
  console.log("[auto-save-design colorRemove] shirt color:", shirtColor);

  const inner2 = INNER_THRESHOLD * INNER_THRESHOLD;
  const outer2 = OUTER_THRESHOLD * OUTER_THRESHOLD;
  const range = OUTER_THRESHOLD - INNER_THRESHOLD;

  // Pass 1: assign alpha based on distance to shirt color.
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i]     - shirtColor.r;
    const dg = data[i + 1] - shirtColor.g;
    const db = data[i + 2] - shirtColor.b;
    const d2 = dr * dr + dg * dg + db * db;

    if (d2 <= inner2) {
      data[i + 3] = 0;
    } else if (d2 < outer2) {
      const d = Math.sqrt(d2);
      const t = (d - INNER_THRESHOLD) / range;
      data[i + 3] = Math.round(data[i + 3] * t);
    }
  }

  // Pass 2: despill — recover true design color at semi-transparent edge pixels.
  // An edge pixel stores a blend: pixel = t*design + (1-t)*shirt.
  // Solving for design: design = (pixel - (1-t)*shirt) / t.
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a <= MIN_ALPHA_DESPILL || a === 255) continue;
    const t  = a / 255;
    const it = 1 - t;
    data[i]     = Math.min(255, Math.max(0, Math.round((data[i]     - it * shirtColor.r) / t)));
    data[i + 1] = Math.min(255, Math.max(0, Math.round((data[i + 1] - it * shirtColor.g) / t)));
    data[i + 2] = Math.min(255, Math.max(0, Math.round((data[i + 2] - it * shirtColor.b) / t)));
  }

  ctx.putImageData(img, 0, 0);
  return await canvas.convertToBlob({ type: "image/png" });
}

function estimateCornerColor(data, w, h) {
  const patch = Math.min(CORNER_SIZE, Math.floor(Math.min(w, h) / 8));
  const samples = [];
  for (const [sx, sy] of [
    [0, 0],
    [w - patch, 0],
    [0, h - patch],
    [w - patch, h - patch],
  ]) {
    for (let y = sy; y < sy + patch; y++) {
      for (let x = sx; x < sx + patch; x++) {
        const idx = (y * w + x) * 4;
        samples.push([data[idx], data[idx + 1], data[idx + 2]]);
      }
    }
  }
  return medianColor(samples);
}

function medianColor(samples) {
  const rs = samples.map((s) => s[0]).sort((a, b) => a - b);
  const gs = samples.map((s) => s[1]).sort((a, b) => a - b);
  const bs = samples.map((s) => s[2]).sort((a, b) => a - b);
  const m = rs.length >> 1;
  return { r: rs[m], g: gs[m], b: bs[m] };
}
