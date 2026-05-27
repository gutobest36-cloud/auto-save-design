import { removeBackground } from "@imgly/background-removal";

/**
 * Sandbox page — hosts the @imgly/background-removal pipeline.
 *
 * Why a sandbox: MV3 extension pages have a CSP of
 * `script-src 'self' 'wasm-unsafe-eval'` which forbids loading scripts from
 * `blob:` URLs. ONNX Runtime (used by imgly) creates Web Workers from blob
 * URLs internally, so it cannot run on a normal extension page (popup,
 * offscreen, etc.). Sandbox pages, on the other hand, get a permissive CSP
 * that allows blob: workers — at the cost of losing access to chrome.* APIs.
 *
 * The offscreen document hosts an <iframe src="sandbox.html"> and talks to
 * us via window.postMessage. We never call chrome.* here.
 */

window.addEventListener("message", async (event) => {
  const msg = event.data;
  if (!msg || msg.type !== "REMOVE_BG") return;
  const { id, imageBuffer, mime } = msg;

  try {
    const inputBlob = new Blob([imageBuffer], { type: mime || "image/png" });
    const outputBlob = await removeBackground(inputBlob, {
      output: { format: "image/png", quality: 1 },
    });
    const outputBuffer = await outputBlob.arrayBuffer();
    event.source.postMessage(
      {
        type: "REMOVE_BG_RESULT",
        id,
        ok: true,
        imageBuffer: outputBuffer,
        mime: "image/png",
      },
      event.origin || "*",
      [outputBuffer],
    );
  } catch (err) {
    event.source.postMessage(
      {
        type: "REMOVE_BG_RESULT",
        id,
        ok: false,
        error: err?.message ?? String(err),
      },
      event.origin || "*",
    );
  }
});

// Signal the parent we're ready to accept work.
window.parent.postMessage({ type: "SANDBOX_READY" }, "*");
