import { pingRembg, pingHF } from "./lib/rembgClient.js";

const SUBFOLDER_KEY    = "subfolder";
const DEFAULT_SUBFOLDER = "auto-save-design";

const subfolderInput   = document.getElementById("subfolder");
const preview          = document.getElementById("path-preview");
const statusBox        = document.getElementById("status");
const statusTitle      = document.getElementById("status-title");
const statusMessage    = document.getElementById("status-message");
const bgMethodSelect   = document.getElementById("bg-method");

const hfSettings       = document.getElementById("hf-settings");
const hfTokenInput     = document.getElementById("hf-token");
const hfTestBtn        = document.getElementById("hf-test");
const hfPing           = document.getElementById("hf-ping");

const rembgSettings    = document.getElementById("rembg-settings");
const rembgUrlInput    = document.getElementById("rembg-url");
const rembgTestBtn     = document.getElementById("rembg-test");
const rembgPing        = document.getElementById("rembg-ping");
const methodHint       = document.getElementById("method-hint");

// ── Walmart Tool ──
const walmartEnabledChk = document.getElementById("walmart-enabled");
const walmartUrlRow     = document.getElementById("walmart-url-row");
const walmartUrlInput   = document.getElementById("walmart-url");
const walmartTestBtn    = document.getElementById("walmart-test");
const walmartPing       = document.getElementById("walmart-ping");

const HINTS = {
  chroma: "Xóa nền theo màu góc ảnh. Nhanh, offline, phù hợp nền đơn sắc.",
  hf:     "AI RMBG-1.4 chạy trên Hugging Face. Chất lượng cao, miễn phí với HF token.",
  rembg:  "AI xóa nền local (U2Net). Tốt nhất, cần cài Python + rembg.",
};

init().catch(console.error);

async function init() {
  const stored = await chrome.storage.local.get([
    SUBFOLDER_KEY, "bgMethod", "rembgUrl", "hfToken",
    "walmartEnabled", "walmartUrl",
  ]);
  subfolderInput.value = stored[SUBFOLDER_KEY] ?? DEFAULT_SUBFOLDER;
  updatePreview(subfolderInput.value);

  const method = stored.bgMethod ?? "chroma";
  bgMethodSelect.value = method;
  rembgUrlInput.value  = stored.rembgUrl ?? "http://localhost:7000";
  hfTokenInput.value   = stored.hfToken  ?? "";
  applyMethodUi(method);

  // Walmart
  const wEnabled = stored.walmartEnabled ?? false;
  walmartEnabledChk.checked = wEnabled;
  walmartUrlInput.value     = stored.walmartUrl ?? "http://localhost:5000";
  walmartUrlRow.hidden      = !wEnabled;
}

// ── Subfolder ──
subfolderInput.addEventListener("input", async () => {
  const value = sanitizeSubfolder(subfolderInput.value);
  updatePreview(value);
  await chrome.storage.local.set({ [SUBFOLDER_KEY]: value });
});

// ── BG method ──
bgMethodSelect.addEventListener("change", async () => {
  const method = bgMethodSelect.value;
  applyMethodUi(method);
  await chrome.storage.local.set({ bgMethod: method });
});

// ── HF token ──
hfTokenInput.addEventListener("input", async () => {
  await chrome.storage.local.set({ hfToken: hfTokenInput.value.trim() });
  hfPing.textContent = "";
});

hfTestBtn.addEventListener("click", async () => {
  hfPing.innerHTML   = "Đang kiểm tra…";
  hfPing.style.color = "var(--subtle)";
  const token = hfTokenInput.value.trim();
  if (!token) {
    hfPing.textContent = "Chưa nhập token";
    hfPing.style.color = "var(--err)";
    return;
  }
  try {
    const { ok, message } = await pingHF(token);
    hfPing.style.color = ok ? "var(--ok)" : "var(--err)";
    if (!ok && message.includes("accept license")) {
      hfPing.innerHTML =
        `${message} → <a href="https://huggingface.co/briaai/RMBG-1.4"
          target="_blank" style="color:var(--accent)">Mở trang để đồng ý</a>`;
    } else {
      hfPing.textContent = message;
    }
  } catch (e) {
    hfPing.textContent = "Lỗi: " + e.message;
    hfPing.style.color = "var(--err)";
  }
});

// ── rembg URL ──
rembgUrlInput.addEventListener("input", async () => {
  await chrome.storage.local.set({
    rembgUrl: rembgUrlInput.value.trim() || "http://localhost:7000",
  });
  rembgPing.textContent = "";
});

rembgTestBtn.addEventListener("click", async () => {
  rembgPing.textContent = "Đang kiểm tra…";
  rembgPing.style.color = "var(--subtle)";
  const url = rembgUrlInput.value.trim() || "http://localhost:7000";
  try {
    const ok = await pingRembg(url);
    rembgPing.textContent = ok ? "✓ Kết nối thành công" : "✗ Không kết nối được";
    rembgPing.style.color = ok ? "var(--ok)" : "var(--err)";
  } catch {
    rembgPing.textContent = "Lỗi kết nối";
    rembgPing.style.color = "var(--err)";
  }
});

// ── Walmart Tool ──
walmartEnabledChk.addEventListener("change", async () => {
  const checked = walmartEnabledChk.checked;
  walmartUrlRow.hidden = !checked;
  await chrome.storage.local.set({ walmartEnabled: checked });
});

walmartUrlInput.addEventListener("input", async () => {
  walmartPing.textContent = "";
  await chrome.storage.local.set({
    walmartUrl: walmartUrlInput.value.trim() || "http://localhost:5000",
  });
});

walmartTestBtn.addEventListener("click", async () => {
  walmartPing.textContent = "Đang kiểm tra…";
  walmartPing.style.color = "var(--subtle)";
  const url = walmartUrlInput.value.trim() || "http://localhost:5000";
  try {
    const res  = await fetch(`${url}/api/ping`, { signal: AbortSignal.timeout(4000) });
    const json = await res.json();
    if (json.ok) {
      walmartPing.textContent = "✓ Đã kết nối";
      walmartPing.style.color = "var(--ok)";
    } else {
      walmartPing.textContent = "✗ Server không phản hồi đúng";
      walmartPing.style.color = "var(--err)";
    }
  } catch {
    walmartPing.textContent = "✗ Không kết nối — Flask đang chạy chưa?";
    walmartPing.style.color = "var(--err)";
  }
});

// ── Messages từ offscreen ──
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== "popup") return false;
  if (msg.type === "STATUS") {
    showStatus("Đang xử lý…", msg.payload?.message ?? "", "");
  } else if (msg.type === "RESULT") {
    const { ok, filename, error } = msg.payload ?? {};
    showStatus(
      ok ? "✅ Đã lưu" : "❌ Thất bại",
      ok ? filename : (error ?? "Lỗi không xác định"),
      ok ? "ok" : "err",
    );
  }
  return false;
});

// ── Helpers ──
function applyMethodUi(method) {
  hfSettings.hidden    = method !== "hf";
  rembgSettings.hidden = method !== "rembg";
  methodHint.textContent = HINTS[method] ?? "";
}

function sanitizeSubfolder(raw) {
  return String(raw ?? "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\.\.+/g, "")
    .replace(/[<>:"|?*\x00-\x1f]/g, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/g, "")
    .trim();
}

function updatePreview(value) {
  preview.textContent = value
    ? `Downloads/${value}/<tên sản phẩm>.png`
    : "Downloads/<tên sản phẩm>.png";
}

function showStatus(title, message, kind) {
  statusBox.hidden = false;
  statusBox.classList.remove("ok", "err");
  if (kind) statusBox.classList.add(kind);
  statusTitle.textContent   = title;
  statusMessage.textContent = message;
}
