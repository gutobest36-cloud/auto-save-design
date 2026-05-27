import { build, context } from "esbuild";
import { cp, mkdir, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";

const root = resolve(".");
const dist = resolve("dist");
const watch = process.argv.includes("--watch");

const entries = {
  "src/background": "src/background.js",
  "src/offscreen": "src/offscreen.js",
  "src/popup": "src/popup.js",
  "src/sidepanel": "src/sidepanel.js",
  "src/sandbox": "src/sandbox.js",
};

async function copyStatic() {
  // Files / folders to copy verbatim into dist.
  const items = [
    "manifest.json",
    "src/offscreen.html",
    "src/popup.html",
    "src/popup.css",
    "src/sidepanel.html",
    "src/sidepanel.css",
    "src/sandbox.html",
    "src/content/contextHelper.js",
    "assets",
  ];
  for (const item of items) {
    const from = join(root, item);
    const to = join(dist, item);
    if (!existsSync(from)) continue;
    await mkdir(dirname(to), { recursive: true });
    await cp(from, to, { recursive: true });
  }
  // Optional: copy vendor model assets if present
  const vendor = join(root, "vendor");
  if (existsSync(vendor)) {
    const subdirs = await readdir(vendor);
    if (subdirs.length > 0) {
      await cp(vendor, join(dist, "vendor"), { recursive: true });
    }
  }
}

const common = {
  bundle: true,
  format: "esm",
  target: "chrome120",
  platform: "browser",
  sourcemap: true,
  logLevel: "info",
  legalComments: "none",
  loader: { ".wasm": "file", ".bin": "file", ".onnx": "file" },
  define: { "process.env.NODE_ENV": '"production"' },
};

async function run() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await copyStatic();

  const buildOpts = {
    ...common,
    entryPoints: entries,
    outdir: dist,
    outbase: ".",
    splitting: false,
  };

  if (watch) {
    const ctx = await context(buildOpts);
    await ctx.watch();
    console.log("esbuild: watching for changes...");
  } else {
    await build(buildOpts);
    console.log("esbuild: build complete →", dist);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
