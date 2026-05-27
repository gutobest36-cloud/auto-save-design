/**
 * Draw a cutout bitmap (RGBA, already at the desired display size) onto a
 * fully-transparent canvas of size canvasWidth x canvasHeight, centered on
 * the axis where there is leftover space.
 */
export async function composeOnCanvas(bitmap, opts) {
  const { canvasWidth, canvasHeight, targetWidth, targetHeight } = opts;
  const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  const dx = Math.round((canvasWidth - targetWidth) / 2);
  const dy = Math.round((canvasHeight - targetHeight) / 2);
  ctx.drawImage(bitmap, dx, dy, targetWidth, targetHeight);

  return await canvas.convertToBlob({ type: "image/png" });
}
