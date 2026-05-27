const INVALID = /[\\/:*?"<>|\x00-\x1f]/g;
const RESERVED_WIN = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
const MAX_LEN = 120;

const SITE_SUFFIX = [
  /\s*[-|–—:]\s*Amazon(\.[a-z.]+)?.*$/i,
  /\s*[-|–—]\s*Etsy.*$/i,
  /\s*[-|–—]\s*eBay.*$/i,
  /\s*[-|–—]\s*Walmart(\.com)?.*$/i,
  /\s*[-|–—]\s*Target(\.com)?.*$/i,
  /\s*[-|–—]\s*Shopify.*$/i,
  /\s*[-|–—]\s*AliExpress.*$/i,
  /\s*[-|–—]\s*Wayfair.*$/i,
  /\s*[-|–—]\s*Best\s*Buy.*$/i,
  /\s*[-|–—]\s*Buy.*$/i,
  /\s*[-|–—]\s*Shop.*$/i,
];

/**
 * Sanitize a candidate filename, applying Windows + cross-platform rules.
 */
export function sanitize(name) {
  let s = String(name ?? "").normalize("NFC");
  // Strip common shop suffixes.
  for (const pat of SITE_SUFFIX) s = s.replace(pat, "");
  s = s
    .replace(INVALID, "")
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/g, "")
    .trim();
  if (!s) return "";
  if (RESERVED_WIN.test(s)) s = `_${s}`;
  if (s.length > MAX_LEN) s = s.slice(0, MAX_LEN).trim();
  return s;
}

/**
 * Build the final filename (with `.png` extension) from a raw title.
 * Falls back to a hostname-based timestamped name when title is empty.
 */
export function buildFilename(rawTitle, { pageUrl, srcUrl } = {}) {
  const cleaned = sanitize(rawTitle);
  if (cleaned) return `${cleaned}.png`;

  let host = "image";
  try {
    host = new URL(pageUrl || srcUrl || "").hostname.replace(/^www\./, "");
  } catch {
    /* keep default */
  }
  const ts = timestamp();
  return `design-${sanitize(host) || "image"}-${ts}.png`;
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}
