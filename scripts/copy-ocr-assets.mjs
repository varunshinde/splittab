// Copies the Tesseract OCR runtime assets out of node_modules into
// public/ocr/ so the browser can load them same-origin (CSP-friendly and
// no third-party CDN). The assets are GENERATED — they are gitignored and
// never committed; this runs via the prebuild/predev npm hooks, including
// on Vercel. Sources: tesseract.js (worker), tesseract.js-core (WASM),
// @tesseract.js-data/eng (English language data).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const out = path.join(root, "public", "ocr");

function copyFile(src, dest) {
  if (!fs.existsSync(src)) throw new Error(`OCR asset missing: ${src} (run npm install)`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

copyFile(
  path.join(root, "node_modules", "tesseract.js", "dist", "worker.min.js"),
  path.join(out, "worker.min.js"),
);

const coreDir = path.join(root, "node_modules", "tesseract.js-core");
if (!fs.existsSync(coreDir)) throw new Error("OCR asset missing: tesseract.js-core (run npm install)");
fs.mkdirSync(path.join(out, "core"), { recursive: true });
for (const f of fs.readdirSync(coreDir)) {
  // LSTM builds only (the worker runs OEM LSTM_ONLY): the plain, simd and
  // relaxed-simd variants of the LSTM core. The browser downloads exactly
  // one variant; the non-LSTM cores are never used and not copied.
  if (f.includes("-lstm.") && (f.endsWith(".js") || f.endsWith(".wasm"))) {
    fs.copyFileSync(path.join(coreDir, f), path.join(out, "core", f));
  }
}

copyFile(
  path.join(root, "node_modules", "@tesseract.js-data", "eng", "4.0.0", "eng.traineddata.gz"),
  path.join(out, "lang", "eng.traineddata.gz"),
);

console.log("OCR assets copied to public/ocr/");
