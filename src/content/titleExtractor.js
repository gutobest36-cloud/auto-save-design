/**
 * Title extractor + in-page image fetcher. Both run inside the page's MAIN
 * world via chrome.scripting.executeScript({func}). Helpers are nested so
 * the functions survive .toString() serialization.
 *
 * Fetching the image from the page context (instead of the service worker)
 * is more reliable: the page provides the correct Referer, cookies, and
 * any session-based auth, which many product CDNs require.
 */

export function extractProductTitle(imgUrl) {
  function fromJsonLd() {
    const scripts = document.querySelectorAll(
      'script[type="application/ld+json"]',
    );
    for (const s of scripts) {
      let parsed;
      try {
        parsed = JSON.parse(s.textContent || "null");
      } catch {
        continue;
      }
      const stack = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (stack.length) {
        const node = stack.shift();
        if (!node || typeof node !== "object") continue;
        const t = node["@type"];
        const isProduct =
          t === "Product" || (Array.isArray(t) && t.includes("Product"));
        if (isProduct && typeof node.name === "string" && node.name.trim()) {
          return node.name.trim();
        }
        if (Array.isArray(node["@graph"])) stack.push(...node["@graph"]);
        for (const v of Object.values(node)) {
          if (Array.isArray(v)) stack.push(...v);
          else if (v && typeof v === "object") stack.push(v);
        }
      }
    }
    return "";
  }

  function fromMeta(selector) {
    const el = document.querySelector(selector);
    const v = el?.getAttribute("content");
    return (v && v.trim()) || "";
  }

  function findImg() {
    return (
      [...document.images].find((i) => i.currentSrc === imgUrl) ||
      [...document.images].find((i) => i.src === imgUrl) ||
      null
    );
  }

  function fromNearestHeading() {
    const img = findImg();
    if (!img) return "";
    let node = img.parentElement;
    while (node && node !== document.body) {
      const h = node.querySelector("h1, h2");
      if (h?.textContent?.trim()) return h.textContent.trim();
      node = node.parentElement;
    }
    return "";
  }

  function fromAlt() {
    const img = findImg();
    return (img?.alt || "").trim();
  }

  return (
    fromJsonLd() ||
    fromMeta('meta[property="og:title"]') ||
    fromMeta('meta[name="twitter:title"]') ||
    fromNearestHeading() ||
    (document.title || "").trim() ||
    fromAlt() ||
    ""
  );
}

/**
 * Fetch the image from the page's context and return it as a data URL
 * (or null on failure). The page world has the correct Referer + cookies
 * for the host, so this succeeds on many sites where a service-worker
 * fetch returns a placeholder or 403.
 */
export async function fetchImageInPage(imgUrl) {
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  // Strategy 1: plain fetch in page context.
  try {
    const res = await fetch(imgUrl, { credentials: "include" });
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 1024 && blob.type.startsWith("image/")) {
        return await blobToDataUrl(blob);
      }
    }
  } catch {
    /* fall through */
  }

  // Strategy 2: pull pixels from the already-rendered <img> via canvas.
  // Reject icons / placeholders by enforcing a minimum natural size.
  try {
    const img =
      [...document.images].find((i) => i.currentSrc === imgUrl) ||
      [...document.images].find((i) => i.src === imgUrl);
    if (
      img &&
      img.complete &&
      img.naturalWidth >= 200 &&
      img.naturalHeight >= 200
    ) {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d").drawImage(img, 0, 0);
      return c.toDataURL("image/png");
    }
  } catch {
    /* canvas tainted or other error */
  }

  return null;
}
