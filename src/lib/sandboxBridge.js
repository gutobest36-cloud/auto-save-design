/**
 * Bridge between the offscreen document and the sandboxed bg-removal page.
 *
 * MV3 extension pages can't host the imgly bg-removal pipeline (its ONNX
 * Runtime creates blob: Web Workers, which the extension CSP forbids).
 * The sandbox page can — at the cost of no chrome.* access. We embed it
 * in an iframe and exchange data via postMessage.
 */

let iframe = null;
let readyPromise = null;
let pending = new Map();
let nextId = 1;

function ensureIframe() {
  if (iframe) return readyPromise;

  iframe = document.createElement("iframe");
  iframe.src = chrome.runtime.getURL("src/sandbox.html");
  // Hide it; the page is purely for compute.
  iframe.style.cssText =
    "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;";
  document.body.appendChild(iframe);

  readyPromise = new Promise((resolve) => {
    function onReady(event) {
      if (event.source !== iframe.contentWindow) return;
      if (event.data?.type === "SANDBOX_READY") {
        window.removeEventListener("message", onReady);
        resolve();
      }
    }
    window.addEventListener("message", onReady);
  });

  // Dispatch REMOVE_BG_RESULT messages back to their callers.
  window.addEventListener("message", (event) => {
    if (event.source !== iframe.contentWindow) return;
    const msg = event.data;
    if (msg?.type !== "REMOVE_BG_RESULT") return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.ok) entry.resolve(msg);
    else entry.reject(new Error(msg.error || "Sandbox failed"));
  });

  return readyPromise;
}

/**
 * Remove background from `inputBlob` via the sandboxed imgly worker.
 * Returns a new Blob (image/png) with transparent background.
 */
export async function removeBackgroundInSandbox(inputBlob) {
  await ensureIframe();
  const id = nextId++;
  const buffer = await inputBlob.arrayBuffer();
  return new Promise((resolve, reject) => {
    pending.set(id, {
      resolve: (msg) => {
        resolve(new Blob([msg.imageBuffer], { type: msg.mime || "image/png" }));
      },
      reject,
    });
    iframe.contentWindow.postMessage(
      {
        type: "REMOVE_BG",
        id,
        imageBuffer: buffer,
        mime: inputBlob.type || "image/png",
      },
      "*",
      [buffer],
    );
  });
}
