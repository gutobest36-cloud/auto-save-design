# Auto Save Design

Chrome extension dành cho workflow Print-on-Demand: right-click bất kỳ ảnh sản phẩm nào trên web → tự động xoá nền → xuất file PNG **4200 × 4800 px (14" × 16" @ 300 DPI)**, nền trong suốt, ảnh fit hết chiều ngang khung. Tên file lấy theo **tiêu đề sản phẩm** của trang.

Mọi xử lý chạy **local** trong trình duyệt — ảnh không bị gửi ra server bên thứ 3.

## Tính năng

- Trigger: **chuột phải trên ảnh** → "Auto Save Design"
- Xoá nền: `@imgly/background-removal` (WASM + ONNX, local)
- Upscale: `upscaler.js` + ESRGAN-slim khi ảnh nguồn < 4200 px ngang
- Bố cục: design fit toàn bộ chiều ngang, căn giữa chiều dọc trên canvas 4200×4800
- Tên file = tiêu đề sản phẩm (JSON-LD Product → og:title → twitter:title → h1 gần ảnh → document.title → alt)
- Lưu vào folder do user chọn (File System Access API). Fallback xuống Downloads nếu chưa cấu hình.

## Cài đặt (Developer mode)

```bash
cd admin/auto-save-design
npm install
npm run build
```

Sau khi build:

1. Mở `chrome://extensions` → bật **Developer mode**
2. **Load unpacked** → chọn thư mục `admin/auto-save-design/dist`
3. Click icon extension → **Choose folder…** → chọn nơi lưu PNG
4. Vào trang sản phẩm bất kỳ → chuột phải ảnh → **Auto Save Design**

## Vendor assets (model files)

Lần build đầu, esbuild gói model của `@imgly/background-removal` từ `node_modules`. Nếu muốn **self-host** (tránh CDN runtime), copy thư mục model vào `vendor/imgly-bg-removal/` trước khi build:

```bash
cp -r node_modules/@imgly/background-removal/dist/* vendor/imgly-bg-removal/
```

`imageProcessor.js` đã trỏ `publicPath` về `vendor/imgly-bg-removal/` qua `chrome.runtime.getURL()`.

## Icons

Tạm thời extension chạy không icon (Chrome hiển thị puzzle piece mặc định). Để thêm icon, đặt 3 file `assets/icons/16.png`, `48.png`, `128.png` rồi thêm khối sau vào `manifest.json`:

```json
"icons": {
  "16": "assets/icons/16.png",
  "48": "assets/icons/48.png",
  "128": "assets/icons/128.png"
}
```

## Phát triển

```bash
npm run watch    # esbuild watch mode
```

Reload extension trong `chrome://extensions` sau mỗi lần file thay đổi.

DevTools cho từng context:

- Service worker: `chrome://extensions` → extension → "service worker"
- Offscreen document: `chrome://extensions` → extension → "offscreen document"
- Popup: chuột phải vào popup → Inspect

## Cấu trúc

```
admin/auto-save-design/
├── manifest.json
├── build.mjs               # esbuild bundler
├── package.json
├── src/
│   ├── background.js       # MV3 service worker, context menu, title extraction
│   ├── offscreen.html
│   ├── offscreen.js        # điều phối pipeline
│   ├── popup.html / .js / .css
│   ├── content/
│   │   └── titleExtractor.js   # function injected qua scripting.executeScript
│   └── lib/
│       ├── imageProcessor.js   # upscale → bg-removal → compose
│       ├── upscale.js          # wrapper Upscaler.js / ESRGAN-slim
│       ├── compose.js          # vẽ lên canvas 4200×4800
│       ├── fileSystem.js       # DirectoryHandle + idb persistence
│       └── filename.js         # sanitize title → tên file
└── vendor/                 # model assets (optional self-host)
```

## Giới hạn / lưu ý

- Vài site (Amazon, một số CDN) trả ảnh kèm `Access-Control-Allow-Origin` hạn chế; cấu hình `host_permissions: ["<all_urls>"]` thường đủ để service worker fetch được, nhưng nếu fail extension sẽ báo lỗi.
- Lần đầu tiên xử lý ảnh: cần tải model (~40 MB BG removal + ~5 MB ESRGAN). Có thể chậm.
- Memory với ảnh > 2000 px khi upscale lên 4200 px có thể chiếm vài trăm MB RAM trong WebGL.
- File System Access API: Chrome có thể thu hồi quyền sau khi đóng toàn bộ tab — popup có nút "Choose folder…" để reconnect.
