(function () {
  if (window.__asdContextHelperInstalled) return;
  window.__asdContextHelperInstalled = true;

  document.addEventListener(
    "contextmenu",
    (e) => {
      let img = null;

      // ── Strategy 1: elementsFromPoint (bỏ qua pointer-events:none, nên ít khi ra img) ──
      const elements = document.elementsFromPoint(e.clientX, e.clientY);
      img = elements.find((el) => el.tagName === "IMG") || null;

      // ── Strategy 2: Tìm <img> BÊN TRONG các container trả về từ elementsFromPoint ──
      // Xử lý Redbubble: img có pointer-events:none nằm trong div.swiper-zoom-container
      if (!img) {
        for (const el of elements) {
          // Ưu tiên: active slide trong carousel
          const activeSlide =
            el.querySelector(".swiper-slide-active img") ||
            el.querySelector('[class*="active"] img') ||
            el.querySelector('[class*="current"] img') ||
            el.querySelector('[aria-current] img');
          if (activeSlide && activeSlide.naturalWidth > 0) {
            img = activeSlide;
            break;
          }
          // Fallback: bất kỳ img nào đủ lớn bên trong container
          const imgInside = el.querySelector("img");
          if (
            imgInside &&
            (imgInside.naturalWidth > 50 || imgInside.getBoundingClientRect().width > 100)
          ) {
            img = imgInside;
            break;
          }
        }
      }

      // ── Strategy 3: Scan toàn bộ <img> — tìm cái có rect chứa con trỏ ──
      // (kể cả pointer-events:none, vì ta dùng getBoundingClientRect thủ công)
      if (!img) {
        const cx = e.clientX, cy = e.clientY;
        let bestArea = 0;
        for (const i of document.images) {
          // Bỏ qua ảnh chưa load hoặc quá nhỏ
          const rw = i.getBoundingClientRect().width;
          if (rw < 80 && i.naturalWidth < 80) continue;

          const r = i.getBoundingClientRect();
          if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
            const area = r.width * r.height;
            if (area > bestArea) {
              bestArea = area;
              img = i;
            }
          }
        }
      }

      // ── Strategy 4: picture > source[srcset] fallback ──
      if (!img) {
        for (const el of elements) {
          const pic = el.closest?.("picture") || (el.tagName === "PICTURE" ? el : null);
          if (pic) {
            const i = pic.querySelector("img");
            if (i) { img = i; break; }
          }
        }
      }

      // ── Strategy 5: CSS background-image trên container ──
      let bgUrl = null;
      if (!img) {
        for (const el of elements) {
          const bg = window.getComputedStyle(el).backgroundImage;
          if (bg && bg !== "none") {
            const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
            if (m?.[1] && !m[1].startsWith("data:")) {
              bgUrl = m[1];
              break;
            }
          }
        }
      }

      // ── Ghi kết quả ──
      if (img) {
        const src = img.currentSrc || img.src || "";
        window.__asdContextImg = src
          ? {
              url: src,
              naturalWidth:  img.naturalWidth,
              naturalHeight: img.naturalHeight,
            }
          : null;
      } else if (bgUrl) {
        window.__asdContextImg = { url: bgUrl, naturalWidth: 0, naturalHeight: 0 };
      } else {
        window.__asdContextImg = null;
      }
    },
    true, // capture phase
  );
})();
