import { pingRembg } from "./lib/rembgClient.js";

const SUBFOLDER_KEY = "subfolder";
const DEFAULT_SUBFOLDER = "auto-save-design";

const subfolderInput = document.getElementById("subfolder");
const preview = document.getElementById("path-preview");
const statusBox = document.getElementById("status");
const statusTitle = document.getElementById("status-title");
const statusMessage = document.getElementById("status-message");

const bgMethodSelect = document.getElementById("bg-method");
const rembgSettings = document.getElementById("rembg-settings");
const rembgUrlInput = document.getElementById("rembg-url");
const rembgTestBtn = document.getElementById("rembg-test");
const rembgPing = document.getElementById("rembg-ping");
const methodHint = document.getElementById("method-hint");

const HINTS = {
  chroma: "Xóa nền bằng màu góc ảnh. Nhanh, không cần cài đặt gì thêm.",
  rembg:
    "Cần cài Python: pip install rembg[cli] → rembg s (chạy server ở localhost:7000)",
};

init().catch(console.error);

async function init() {
  const stored = await chrome.storage.local.get([
    SUBFOLDER_KEY,
    "bgMethod",
    "rembgUrl",
  ]);

  subfolderInput.value = stored[SUBFOLDER_KEY] ?? DEFAULT_SUBFOLDER;
  updatePreview(subfolderInput.value);

  const method = stored.bgMethod ?? "chroma";
  bgMethodSelect.value = method;
  rembgUrlInput.value = stored.rembgUrl ?? "http://localhost:7000";
  applyMethodUi(method);
}

subfolderInput.addEventListener("input", async () => {
  const value = sanitizeSubfolder(subfolderInput.value);
  updatePreview(value);
  await chrome.storage.local.set({ [SUBFOLDER_KEY]: value });
});

bgMethodSelect.addEventListener("change", async () => {
  const method = bgMethodSelect.value;
  applyMethodUi(method);
  await chrome.storage.local.set({ bgMethod: method });
});

rembgUrlInput.addEventListener("input", async () => {
  const url = rembgUrlInput.value.trim() || "http://localhost:7000";
  await chrome.storage.local.set({ rembgUrl: url });
  rembgPing.textContent = "";
});

rembgTestBtn.addEventListener("click", async () => {
  rembgPing.textContent = "Đang kiểm tra…";
  rembgPing.style.color = "var(--subtle)";
  const url = rembgUrlInput.value.trim() || "http://localhost:7000";
  try {
    const ok = await pingRembg(url);
    if (ok) {
      rembgPing.textContent = "Kết nối thành công";
      rembgPing.style.color = "var(--ok)";
    } else {
      rembgPing.textContent = "Không kết nối được";
      rembgPing.style.color = "var(--err)";
    }
  } catch {
    rembgPing.textContent = "Lỗi kết nối";
    rembgPing.style.color = "var(--err)";
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== "popup") return false;
  if (msg.type === "STATUS") {
    showStatus("Đang xử lý…", msg.payload?.message ?? "", "");
  } else if (msg.type === "RESULT") {
    const { ok, filename, error } = msg.payload ?? {};
    showStatus(
      ok ? "Đã lưu" : "Thất bại",
      ok ? filename : (error ?? "Lỗi không xác định"),
      ok ? "ok" : "err",
    );
  }
  return false;
});

function applyMethodUi(method) {
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
  statusTitle.textContent = title;
  statusMessage.textContent = message;
}
