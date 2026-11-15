// OCR for pages that are only pictures (scans, photos, "printed to image" agendas).
// Uses tesseract.js, bundled with the add-on. All files load from inside the extension, so
// nothing is downloaded and no page image ever leaves the device.

import Tesseract from "../lib/tesseract/tesseract.esm.min.js";

const BASE = new URL("../lib/tesseract/", import.meta.url).href;

// Pages with fewer real characters than this are treated as image-only and get OCR.
export const MIN_TEXT_CHARS = 25;

export function needsOcr(pageText) {
  const real = (pageText || "").replace(/[\s­]/g, "");
  return real.length < MIN_TEXT_CHARS;
}

let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker("eng", Tesseract.OEM.LSTM_ONLY, {
      workerPath: BASE + "worker.min.js",
      corePath: BASE + "core/",
      langPath: BASE + "lang/",
      workerBlobURL: false,
      gzip: true,
      cacheMethod: "none",
    }).then(async (worker) => {
      // Treat the page as a normal document with columns and blocks of text.
      await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.AUTO, preserve_interword_spaces: "1" });
      return worker;
    });
    workerPromise.catch(() => (workerPromise = null));
  }
  return workerPromise;
}

export async function stopOcr() {
  const w = workerPromise;
  workerPromise = null;
  if (w) (await w.catch(() => null))?.terminate();
}

// Renders a PDF page to a canvas at a good OCR resolution and reads it.
// Returns lines of words in PDF page units: [{ words: [{ text, x0, y0, x1, y1, conf }] }]
export async function ocrPage(pdfPage) {
  const base = pdfPage.getViewport({ scale: 1 });
  // About 220 dpi for a letter page, capped so phones don't run out of memory.
  let scale = Math.min(3.2, 2000 / base.width);
  const maxPixels = 9_000_000;
  if (base.width * base.height * scale * scale > maxPixels) scale = Math.sqrt(maxPixels / (base.width * base.height));
  const vp = pdfPage.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await pdfPage.render({ canvasContext: ctx, viewport: vp, background: "#ffffff" }).promise;

  const worker = await getWorker();
  const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false });
  canvas.width = canvas.height = 0;

  const lines = [];
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        const words = [];
        for (const w of line.words || []) {
          const text = (w.text || "").trim();
          if (!text || w.confidence < 15) continue;
          words.push({
            text,
            conf: w.confidence,
            x0: w.bbox.x0 / scale,
            y0: w.bbox.y0 / scale,
            x1: w.bbox.x1 / scale,
            y1: w.bbox.y1 / scale,
          });
        }
        if (words.length) lines.push({ words });
      }
    }
  }
  return lines;
}

// Turns OCR lines into the same item shape pdf.js text gives us, so matching works the same way.
// Spaces between words are separate items with no box (they are never drawn).
export function ocrItems(lines) {
  const items = [];
  for (const line of lines) {
    line.words.forEach((w, i) => {
      const last = i === line.words.length - 1;
      items.push({ str: w.text, hasEOL: last, box: w });
      if (!last) items.push({ str: " ", hasEOL: false, box: null });
    });
  }
  return items;
}

const measureCtx = document.createElement("canvas").getContext("2d");

// Builds an invisible, selectable word layer over the page image, laid out like pdf.js's text layer.
// Returns an object with the same two fields the highlighter uses: textDivs and textContentItemsStr.
export function buildOcrLayer(container, items, pageW, pageH, userUnit = 1) {
  const textDivs = [];
  const textContentItemsStr = [];
  for (const item of items) {
    textContentItemsStr.push(item.str);
    if (!item.box) {
      textDivs.push(null);
      continue;
    }
    const b = item.box;
    const h = Math.max(1, b.y1 - b.y0) / userUnit; // font size is in unscaled PDF units
    const w = Math.max(1, b.x1 - b.x0) / userUnit;
    const span = document.createElement("span");
    span.textContent = item.str;
    span.setAttribute("role", "presentation");
    span.style.left = `${((100 * b.x0) / pageW).toFixed(3)}%`;
    span.style.top = `${((100 * b.y0) / pageH).toFixed(3)}%`;
    span.style.setProperty("--font-height", `${h.toFixed(2)}px`);
    span.style.fontFamily = "sans-serif";
    measureCtx.font = `${h}px sans-serif`;
    const natural = measureCtx.measureText(item.str).width || w;
    span.style.setProperty("--scale-x", String(w / natural));
    container.append(span);
    if (item.hasEOL) container.append(document.createElement("br"));
    textDivs.push(span);
  }
  return { textDivs, textContentItemsStr };
}
