/**
 * Save logic for offscreen documents.
 *
 * MV3 limitations we have to work around:
 *   1. `chrome.downloads` is unavailable in offscreen documents — we forward
 *      to the service worker which has access.
 *   2. FileSystem Access permissions granted in popup do not persist into
 *      the offscreen document, so we use chrome.downloads with a subfolder
 *      under the user's Downloads directory instead. The subfolder name
 *      lives in chrome.storage.local under "subfolder".
 */

export async function saveBlob(blob, filename, subfolder) {
  const safeSub = (subfolder || "").trim();
  const fullName = safeSub ? `${safeSub}/${filename}` : filename;
  console.log(
    "[auto-save-design] saveBlob → chrome.downloads via SW:",
    fullName,
  );

  const dataUrl = await blobToDataUrl(blob);
  const reply = await chrome.runtime.sendMessage({
    target: "background",
    type: "DOWNLOAD",
    payload: { dataUrl, filename: fullName },
  });
  if (!reply?.ok) {
    throw new Error(reply?.error || "Background download failed");
  }
  return fullName;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
