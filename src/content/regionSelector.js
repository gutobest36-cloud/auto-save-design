/**
 * Self-contained region selector — injected via
 * chrome.scripting.executeScript({ func, world: "MAIN" }).
 *
 * KEY DESIGN:
 * - Shows full-viewport overlay (no pre-selection image frame — avoids picking wrong img)
 * - After the user drags, finds the image with MAXIMUM OVERLAP with the selection
 * - Converts screen-coords → natural-pixel-coords using THAT image's rect
 * - Uses capture-phase document listeners to block Swiper/carousel interference
 */
export async function selectRegionAndCrop(imgUrl) {
  return new Promise((resolve) => {
    const Z = 2147483647;

    // ── Overlay ──────────────────────────────────────────────────────────────
    const dim = document.createElement("div");
    dim.style.cssText = `
      position:fixed;inset:0;z-index:${Z};cursor:crosshair;user-select:none;
      background:rgba(0,0,0,0.35);
    `;

    const hint = document.createElement("div");
    hint.textContent = "Kéo chọn vùng thiết kế  •  Enter = xác nhận  •  Esc = hủy";
    hint.style.cssText = `
      position:fixed;left:50%;top:20px;transform:translateX(-50%);
      background:#111;color:#fff;padding:8px 16px;border-radius:8px;
      font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      box-shadow:0 4px 16px rgba(0,0,0,.4);pointer-events:none;z-index:${Z + 1};
      white-space:nowrap;
    `;

    const selBox = document.createElement("div");
    selBox.style.cssText = `
      position:fixed;display:none;
      border:2px dashed #fff;outline:1px solid rgba(0,0,0,.5);
      background:rgba(99,102,241,0.15);
      pointer-events:none;z-index:${Z + 2};
    `;

    const sizeLabel = document.createElement("div");
    sizeLabel.style.cssText = `
      position:fixed;display:none;
      background:#6366f1;color:#fff;
      font:11px/1 -apple-system,sans-serif;font-weight:700;
      padding:3px 7px;border-radius:4px;
      pointer-events:none;z-index:${Z + 3};
    `;

    document.body.append(dim, hint, selBox, sizeLabel);

    let downX = 0, downY = 0, dragging = false, lastSel = null;

    // ── Cleanup ───────────────────────────────────────────────────────────────
    function cleanup() {
      [dim, hint, selBox, sizeLabel].forEach((el) => el.remove());
      document.removeEventListener("mousedown", onDocDown, true);
      document.removeEventListener("mousemove", onDocMove, true);
      document.removeEventListener("mouseup",   onDocUp,   true);
      document.removeEventListener("keydown",   onKey,     true);
    }

    // ── Find image by OVERLAP with the user's selection ───────────────────────
    // Called AFTER selection — much more robust than pre-selection URL matching.
    function findBestImg(sel) {
      const allImgs = [...document.images].filter(
        (i) => i.complete && i.naturalWidth > 50 && i.naturalHeight > 50,
      );

      let best = null, bestScore = -1;

      for (const img of allImgs) {
        const r = img.getBoundingClientRect();
        if (r.width < 5 || r.height < 5) continue;

        // Overlap area between selection and image rect
        const ow = Math.min(sel.right, r.right)   - Math.max(sel.left, r.left);
        const oh = Math.min(sel.bottom, r.bottom) - Math.max(sel.top,  r.top);
        if (ow <= 0 || oh <= 0) continue;

        const selArea  = (sel.right - sel.left) * (sel.bottom - sel.top);
        const imgArea  = r.width * r.height;
        // Overlap fraction relative to selection area + image display area
        let score = (ow * oh) / Math.max(selArea, imgArea, 1);

        // Bonus: URL matches the right-clicked image
        if (img.currentSrc === imgUrl || img.src === imgUrl) score += 5;

        if (score > bestScore) { bestScore = score; best = img; }
      }

      // Fallback: image matching URL (even if off-screen)
      if (!best) {
        best = allImgs.find((i) => i.currentSrc === imgUrl || i.src === imgUrl);
      }

      // Last resort: largest natural-pixel image
      if (!best && allImgs.length > 0) {
        best = allImgs.sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)[0];
      }

      return best;
    }

    // ── Finish ────────────────────────────────────────────────────────────────
    function finish(sel) {
      cleanup();
      if (!sel) return resolve({ cancelled: true });

      const selW = sel.right - sel.left;
      const selH = sel.bottom - sel.top;
      if (selW < 4 || selH < 4) return resolve({ cancelled: true });

      const img = findBestImg(sel);
      if (!img) return resolve({ error: "Không tìm thấy ảnh trong vùng đã chọn" });

      const rect   = img.getBoundingClientRect();
      const scaleX = img.naturalWidth  / Math.max(rect.width,  1);
      const scaleY = img.naturalHeight / Math.max(rect.height, 1);

      resolve({
        cropX: Math.round((sel.left - rect.left) * scaleX),
        cropY: Math.round((sel.top  - rect.top)  * scaleY),
        cropW: Math.round(selW * scaleX),
        cropH: Math.round(selH * scaleY),
        naturalW: img.naturalWidth,
        naturalH: img.naturalHeight,
      });
    }

    // ── Keyboard ──────────────────────────────────────────────────────────────
    function onKey(e) {
      if (e.key === "Escape") {
        e.stopPropagation(); e.preventDefault();
        finish(null);
      } else if (e.key === "Enter") {
        e.stopPropagation(); e.preventDefault();
        finish(lastSel);
      }
    }
    document.addEventListener("keydown", onKey, true);

    // ── Mouse (CAPTURE PHASE — fires before Swiper/Redbubble carousel) ────────
    function onDocDown(e) {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      downX = e.clientX; downY = e.clientY;
      dragging = true;
      lastSel  = null;
      selBox.style.display = "block";
      selBox.style.left    = downX + "px";
      selBox.style.top     = downY + "px";
      selBox.style.width   = "0";
      selBox.style.height  = "0";
    }

    function onDocMove(e) {
      if (!dragging) return;
      e.stopPropagation();
      const x = e.clientX, y = e.clientY;
      const left = Math.min(downX, x), top = Math.min(downY, y);
      const w = Math.abs(x - downX),   h = Math.abs(y - downY);
      selBox.style.left   = left + "px";
      selBox.style.top    = top  + "px";
      selBox.style.width  = w    + "px";
      selBox.style.height = h    + "px";
      lastSel = { left, top, right: left + w, bottom: top + h };

      if (w > 20 && h > 20) {
        sizeLabel.textContent = `${w | 0} × ${h | 0} px (screen)`;
        sizeLabel.style.display = "block";
        sizeLabel.style.left = (left + 4) + "px";
        sizeLabel.style.top  = (top  + 4) + "px";
      }
    }

    function onDocUp(e) {
      if (!dragging) return;
      e.stopPropagation();
      e.preventDefault();
      dragging = false;
      finish(lastSel);
    }

    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("mousemove", onDocMove, true);
    document.addEventListener("mouseup",   onDocUp,   true);

    // Right-click = cancel
    dim.addEventListener("contextmenu", (e) => {
      e.preventDefault(); e.stopPropagation();
      finish(null);
    });
  });
}
