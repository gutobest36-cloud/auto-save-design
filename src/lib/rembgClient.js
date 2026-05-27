/**
 * Background removal clients — 3 options miễn phí:
 *
 * 1. rembg   — local Python server (pip install rembg[cli] && rembg s)
 *              Chất lượng: ⭐⭐⭐⭐⭐  Unlimited  Cần cài Python
 *
 * 2. hf      — Hugging Face RMBG-1.4 API (briaai/RMBG-1.4)
 *              Chất lượng: ⭐⭐⭐⭐⭐  Free token  Cần internet
 *              Lấy token miễn phí: https://huggingface.co/settings/tokens
 *
 * 3. chroma  — Thuật toán nội bộ (corner color sampling + despill)
 *              Chất lượng: ⭐⭐☆☆☆  Unlimited  Không cần gì
 */

// ─────────────────────────────────────────────
// 1. rembg local server
// ─────────────────────────────────────────────
export async function removeBackgroundRembg(blob, serverUrl = "http://localhost:7000") {
  const form = new FormData();
  form.append("file", blob, "image.png");

  const res = await fetch(`${serverUrl}/api/remove`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`rembg: HTTP ${res.status}${text ? " — " + text.slice(0, 120) : ""}`);
  }

  return await res.blob();
}

export async function pingRembg(serverUrl = "http://localhost:7000") {
  try {
    const res = await fetch(`${serverUrl}/api/remove`, {
      method: "POST",
      body: new FormData(),
      signal: AbortSignal.timeout(4000),
    });
    return res.status === 200 || res.status === 422;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────
// 2. Hugging Face RMBG-1.4 (briaai/RMBG-1.4)
//    Hoàn toàn miễn phí với HF free token
//    Model chất lượng AI thực sự, ngang rembg
// ─────────────────────────────────────────────
const HF_MODEL_URL =
  "https://api-inference.huggingface.co/models/briaai/RMBG-1.4";

export async function removeBackgroundHF(blob, hfToken) {
  if (!hfToken || !hfToken.trim()) {
    throw new Error("Chưa nhập Hugging Face token. Vào Settings để thêm token.");
  }

  const buffer = await blob.arrayBuffer();

  const res = await fetch(HF_MODEL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${hfToken.trim()}`,
      "Content-Type": blob.type || "image/png",
      "x-use-cache": "false",
    },
    body: buffer,
  });

  if (res.status === 503) {
    // Model đang warm-up, thử lại sau 20s
    const json = await res.json().catch(() => ({}));
    const wait = Math.min((json.estimated_time ?? 20) * 1000, 30000);
    await new Promise((r) => setTimeout(r, wait));
    return removeBackgroundHF(blob, hfToken); // retry once
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HF RMBG-1.4: HTTP ${res.status}${text ? " — " + text.slice(0, 150) : ""}`);
  }

  const resultBlob = await res.blob();

  // HF trả về PNG hoặc có thể trả về JSON nếu lỗi
  if (!resultBlob.type.startsWith("image/")) {
    const text = await resultBlob.text().catch(() => "");
    throw new Error(`HF trả về không phải ảnh: ${text.slice(0, 150)}`);
  }

  return resultBlob;
}

/**
 * Kiểm tra HF token, trả về { ok, message }
 * Các lỗi thường gặp:
 *  - 401/403 → token sai hoặc không có quyền
 *  - 403 + "gated" → chưa accept license tại huggingface.co/briaai/RMBG-1.4
 *  - 503 → model đang warm-up (token OK)
 *  - 200/422 → token OK
 */
export async function pingHF(hfToken) {
  if (!hfToken?.trim()) return { ok: false, message: "Chưa nhập token" };
  try {
    // Validate token qua HF whoami API (không cần gọi model)
    const whoami = await fetch("https://huggingface.co/api/whoami-v2", {
      headers: { Authorization: `Bearer ${hfToken.trim()}` },
      signal: AbortSignal.timeout(6000),
    });
    if (whoami.status === 401) return { ok: false, message: "Token không hợp lệ (401)" };
    if (!whoami.ok)            return { ok: false, message: `HF lỗi ${whoami.status}` };

    const info = await whoami.json().catch(() => ({}));
    const name = info?.name || info?.fullname || "unknown";

    // Kiểm tra model có accessible không
    const modelCheck = await fetch("https://huggingface.co/api/models/briaai/RMBG-1.4", {
      headers: { Authorization: `Bearer ${hfToken.trim()}` },
      signal: AbortSignal.timeout(6000),
    });
    if (modelCheck.status === 403) {
      return {
        ok: false,
        message: `Token OK (${name}) nhưng chưa accept license model → mở briaai/RMBG-1.4 trên HF để đồng ý`,
      };
    }

    return { ok: true, message: `✓ Token OK — tài khoản: ${name}` };
  } catch (e) {
    return { ok: false, message: `Lỗi kết nối: ${e.message}` };
  }
}
