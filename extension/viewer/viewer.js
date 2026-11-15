// PDF Term Finder viewer: renders a PDF with pdf.js, finds the saved terms,
// highlights them, and lists every match with its context in the side panel.
// Nothing here sends data anywhere; the only network request is downloading the PDF you opened.

import * as pdfjsLib from "../lib/pdfjs/pdf.min.mjs";
import {
  parseTerms,
  buildMatcher,
  findMatches,
  buildPageText,
  matchToPieces,
  contextOf,
} from "./matcher.js";
import {
  loadSettings,
  saveSettings,
  onSettingsChanged,
  activePreset,
  switchPreset,
  updatePreset,
  createPreset,
  deletePreset,
} from "./settings.js";
import { needsOcr, ocrPage, ocrItems, buildOcrLayer } from "./ocr.js";

const LIB = new URL("../lib/pdfjs/", import.meta.url).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = LIB + "pdf.worker.min.mjs";

const COLORS = 8;
const SVG_NS = "http://www.w3.org/2000/svg";

// Small DOM builder: h("p", { className: "x" }, "text", childNode)
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "dataset") Object.assign(node.dataset, v);
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}
const MAX_CANVAS_PIXELS = 16_000_000;
const HITS_PER_CHUNK = 200; // hits shown at a time in an expanded term list

const $ = (id) => document.getElementById(id);
const el = {
  body: document.body,
  title: $("docTitle"),
  scroller: $("scroller"),
  pages: $("pages"),
  message: $("message"),
  panel: $("panel"),
  panelToggle: $("panelToggle"),
  sheetHandle: $("sheetHandle"),
  scanStatus: $("scanStatus"),
  termList: $("termList"),
  editBtn: $("editTermsBtn"),
  editor: $("termEditor"),
  termsInput: $("termsInput"),
  optEndings: $("optEndings"),
  optInside: $("optInside"),
  optOcr: $("optOcr"),
  presetSelect: $("presetSelect"),
  presetName: $("presetName"),
  saveAsNew: $("saveAsNew"),
  deletePreset: $("deletePreset"),
  cancelEdit: $("cancelEdit"),
  prevHit: $("prevHit"),
  nextHit: $("nextHit"),
  hitPos: $("hitPos"),
  zoomIn: $("zoomIn"),
  zoomOut: $("zoomOut"),
  zoomFit: $("zoomFit"),
  fileInput: $("fileInput"),
  dropHint: $("dropHint"),
};

const state = {
  token: 0, // bumps every time a new document loads, to stop stale work
  loadingTask: null,
  doc: null,
  pages: [], // { num, w, h, userUnit, div, textContent, pageText, hitIds, rendered, ... }
  scanned: 0,
  scanDone: false,
  scale: 1,
  fit: true,
  settings: null,
  terms: [],
  matcher: null,
  hits: [], // { id, page, term, start, end } in document order
  byTerm: [], // term index -> hit ids in document order
  current: -1,
  termUI: [], // term index -> { section, count, tpos, list, built, open }
};

/* ------------------------------------------------------------------ */
/* Settings and term list                                             */
/* ------------------------------------------------------------------ */

function renderPresetSelect(settings) {
  const sel = el.presetSelect;
  sel.textContent = "";
  for (const p of settings.presets) {
    sel.append(h("option", { value: p.id, selected: p.id === settings.activePreset }, p.name));
  }
  sel.value = settings.activePreset;
}

el.presetSelect.addEventListener("change", () => {
  openEditor(false);
  switchPreset(el.presetSelect.value); // the storage listener re-runs the search
});

function applySettings(settings) {
  renderPresetSelect(settings);
  const termsChanged = !state.settings || state.settings.termsText !== settings.termsText ||
    state.settings.wordEndings !== settings.wordEndings || state.settings.insideWords !== settings.insideWords;
  const ocrWasOn = state.settings ? state.settings.ocr !== false : null;
  state.settings = settings;
  const ocrOn = settings.ocr !== false;
  if (ocrWasOn !== null && ocrWasOn !== ocrOn && state.doc) {
    if (ocrOn) runOcr(state.token);
    else removeOcrResults();
  }
  if (!termsChanged) return;
  state.terms = parseTerms(settings.termsText);
  state.matcher = buildMatcher(state.terms, settings);
  rematchAll();
}

function rematchAll() {
  state.hits = [];
  state.byTerm = state.terms.map(() => []);
  state.current = -1;
  for (const p of state.pages) {
    if (p.pageText) addPageHits(p);
  }
  buildTermList();
  for (const p of state.pages) if (p.textLayer) applyHighlights(p);
  updateNav();
  if (state.scanDone) finishScan(); // refresh the match total in the panel header
}

// Rebuilds the match list in page order without resetting the panel (used when OCR adds text to a page).
function reindexHits() {
  const cur = state.hits[state.current];
  state.hits = [];
  state.byTerm = state.terms.map(() => []);
  for (const p of state.pages) if (p.pageText) addPageHits(p);
  state.current = cur
    ? state.hits.findIndex((h) => h.page === cur.page && h.start === cur.start && h.term === cur.term)
    : -1;
  for (const ui of state.termUI) {
    ui.list.textContent = "";
    ui.built = 0;
  }
  updateTermCounts();
  for (const p of state.pages) if (p.textLayer) applyHighlights(p);
  updateNav();
}

function addPageHits(p) {
  p.hitIds = [];
  for (const m of findMatches(p.pageText.text, state.matcher)) {
    const id = state.hits.length;
    state.hits.push({ id, page: p.num, term: m.term, start: m.start, end: m.end });
    state.byTerm[m.term].push(id);
    p.hitIds.push(id);
  }
}

function openEditor(show) {
  const open = show ?? el.editor.hidden;
  el.editor.hidden = !open;
  el.editBtn.setAttribute("aria-expanded", String(open));
  if (open) {
    el.termsInput.value = state.settings.termsText;
    el.presetName.value = activePreset(state.settings).name;
    el.deletePreset.disabled = state.settings.presets.length <= 1;
    el.optEndings.checked = !!state.settings.wordEndings;
    el.optInside.checked = !!state.settings.insideWords;
    el.optOcr.checked = state.settings.ocr !== false;
    showPanel(true);
    el.termsInput.focus();
  }
}

el.editBtn.addEventListener("click", () => openEditor());
el.cancelEdit.addEventListener("click", () => openEditor(false));
function editorOptions() {
  return { wordEndings: el.optEndings.checked, insideWords: el.optInside.checked, ocr: el.optOcr.checked };
}

el.editor.addEventListener("submit", async (e) => {
  e.preventDefault();
  await saveSettings(editorOptions());
  await updatePreset(state.settings.activePreset, { name: el.presetName.value, termsText: el.termsInput.value });
  openEditor(false); // the storage listener re-runs the search
});

el.saveAsNew.addEventListener("click", async () => {
  const current = activePreset(state.settings).name;
  let name = el.presetName.value.trim();
  if (!name || name === current) name = window.prompt("Name for the new preset:", `${current} (copy)`)?.trim();
  if (!name) return;
  await saveSettings(editorOptions());
  await createPreset(name, el.termsInput.value);
  openEditor(false);
});

el.deletePreset.addEventListener("click", async () => {
  const p = activePreset(state.settings);
  if (!window.confirm(`Delete the preset “${p.name}”? Its term list will be removed from this device.`)) return;
  await deletePreset(p.id);
  openEditor(false);
});

/* ------------------------------------------------------------------ */
/* Side panel                                                         */
/* ------------------------------------------------------------------ */

function buildTermList() {
  el.termList.textContent = "";
  state.termUI = [];

  if (!state.terms.length) {
    const box = h("div", { className: "empty-terms" }, h("p", {}, "No terms yet. Add the words and phrases you want to find."));
    const btn = document.createElement("button");
    btn.className = "btn primary";
    btn.type = "button";
    btn.textContent = "Add terms";
    btn.addEventListener("click", () => openEditor(true));
    box.append(btn);
    el.termList.append(box);
    return;
  }

  state.terms.forEach((term, t) => {
    const section = document.createElement("section");
    section.className = "term";
    section.style.setProperty("--hl", `var(--c${t % COLORS})`);

    const head = document.createElement("div");
    head.className = "term-head";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "term-toggle";
    toggle.setAttribute("aria-expanded", "false");
    toggle.title = "Show every match with its context";
    const sw = document.createElement("span");
    sw.className = "swatch";
    const name = document.createElement("span");
    name.className = "term-name";
    name.textContent = term;
    const count = document.createElement("span");
    count.className = "count";
    toggle.append(sw, name, count);

    const nav = document.createElement("div");
    nav.className = "term-nav";
    const prev = iconButton("M12.5 4.5 7 10l5.5 5.5", `Previous “${term}”`);
    const tpos = document.createElement("span");
    tpos.className = "tpos";
    const next = iconButton("M7.5 4.5 13 10l-5.5 5.5", `Next “${term}”`);
    nav.append(prev, tpos, next);
    head.append(toggle, nav);

    const list = document.createElement("ol");
    list.className = "hits";
    list.hidden = true;

    section.append(head, list);
    el.termList.append(section);

    const ui = { section, toggle, count, tpos, prev, next, list, built: 0, open: false };
    state.termUI[t] = ui;

    toggle.addEventListener("click", () => {
      ui.open = !ui.open;
      toggle.setAttribute("aria-expanded", String(ui.open));
      list.hidden = !ui.open;
      if (ui.open) fillHitList(t);
    });
    prev.addEventListener("click", () => stepTerm(t, -1));
    next.addEventListener("click", () => stepTerm(t, 1));
  });
  updateTermCounts();
}

function iconButton(path, label) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn icon";
  b.title = label;
  b.setAttribute("aria-label", label);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  const pathEl = document.createElementNS(SVG_NS, "path");
  pathEl.setAttribute("d", path);
  svg.append(pathEl);
  b.append(svg);
  return b;
}

function updateTermCounts() {
  state.termUI.forEach((ui, t) => {
    const n = state.byTerm[t]?.length || 0;
    ui.count.textContent = String(n);
    ui.section.classList.toggle("none", state.scanDone && n === 0);
    ui.prev.disabled = ui.next.disabled = n === 0;
    if (ui.open) fillHitList(t);
  });
  updateTermPositions();
}

// Adds list rows for hits not shown yet (in chunks, so huge lists stay fast).
function fillHitList(t, more = false) {
  const ui = state.termUI[t];
  const ids = state.byTerm[t];
  ui.list.querySelector(".more-hits")?.remove();
  const limit = more ? ui.built + HITS_PER_CHUNK : Math.max(ui.built, HITS_PER_CHUNK);
  while (ui.built < ids.length && ui.built < limit) {
    ui.list.append(hitRow(state.hits[ids[ui.built]]));
    ui.built++;
  }
  if (ui.built < ids.length) {
    const li = document.createElement("li");
    li.className = "more-hits";
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn small";
    b.textContent = `Show ${Math.min(HITS_PER_CHUNK, ids.length - ui.built)} more`;
    b.addEventListener("click", () => fillHitList(t, true));
    li.append(b);
    ui.list.append(li);
  }
  if (!ids.length && !ui.list.childElementCount) {
    const li = document.createElement("li");
    li.className = "hint";
    li.style.padding = "4px 8px";
    li.textContent = state.scanDone ? "Not found in this PDF." : "Still scanning…";
    ui.list.append(li);
  } else if (ids.length) {
    ui.list.querySelector("li.hint")?.remove();
  }
  markActiveRow();
}

function hitRow(hit) {
  const li = document.createElement("li");
  const b = document.createElement("button");
  b.type = "button";
  b.className = "hit";
  b.dataset.hit = hit.id;
  const pg = document.createElement("span");
  pg.className = "pg";
  pg.textContent = `p. ${hit.page}`;
  if (state.pages[hit.page - 1].ocr) {
    pg.append(h("span", { className: "ocr-badge", title: "Found by reading the page image (OCR). Spelling may be off." }, "OCR"));
  }
  const ctx = document.createElement("span");
  ctx.className = "ctx";
  const c = contextOf(state.pages[hit.page - 1].pageText.text, hit.start, hit.end);
  const mark = document.createElement("mark");
  mark.textContent = c.match;
  ctx.append(c.before, mark, c.after);
  b.append(pg, ctx);
  b.addEventListener("click", () => {
    jumpTo(hit.id);
    // On phones keep the list open (so next/previous for this term stay at hand) but not covering the page.
    if (isNarrow() && el.body.classList.contains("sheet-tall")) setSheet("normal");
  });
  li.append(b);
  return li;
}

function markActiveRow() {
  el.termList.querySelectorAll(".hit.active").forEach((b) => b.classList.remove("active"));
  if (state.current < 0) return;
  const row = el.termList.querySelector(`.hit[data-hit="${state.current}"]`);
  if (row) row.classList.add("active");
}

function updateTermPositions() {
  const cur = state.hits[state.current];
  state.termUI.forEach((ui, t) => {
    const n = state.byTerm[t]?.length || 0;
    if (cur && cur.term === t) {
      ui.tpos.textContent = `${state.byTerm[t].indexOf(cur.id) + 1}/${n}`;
    } else {
      ui.tpos.textContent = n ? `–/${n}` : "0";
    }
  });
}

function showPanel(show) {
  el.body.classList.toggle("panel-hidden", !show);
  el.panelToggle.setAttribute("aria-expanded", String(show));
}
el.panelToggle.addEventListener("click", () => {
  showPanel(el.body.classList.contains("panel-hidden"));
  if (state.fit) requestAnimationFrame(refit);
});

// Phone bottom sheet: short (just the header), normal, tall.
function setSheet(size) {
  el.body.classList.toggle("panel-hidden", size === "short");
  el.body.classList.toggle("sheet-tall", size === "tall");
}
el.sheetHandle.addEventListener("click", () => {
  if (el.body.classList.contains("panel-hidden")) setSheet("normal");
  else if (el.body.classList.contains("sheet-tall")) setSheet("short");
  else setSheet("tall");
});
const isNarrow = () => matchMedia("(max-width: 760px)").matches;

/* ------------------------------------------------------------------ */
/* Navigation between matches                                         */
/* ------------------------------------------------------------------ */

function updateNav() {
  const n = state.hits.length;
  el.prevHit.disabled = el.nextHit.disabled = n === 0;
  if (!state.doc) el.hitPos.textContent = "";
  else if (n === 0) el.hitPos.textContent = state.scanDone ? "No matches" : "Scanning…";
  else if (state.current < 0) el.hitPos.textContent = `${n} match${n === 1 ? "" : "es"}`;
  else el.hitPos.textContent = `${state.current + 1} of ${n}`;
}

function stepAll(dir) {
  const n = state.hits.length;
  if (!n) return;
  let next;
  if (state.current < 0) next = dir > 0 ? firstHitFromView() : lastHitBeforeView();
  else next = (state.current + dir + n) % n;
  jumpTo(next);
}

// Next/previous match of one term, starting from the current match (or the current view).
function stepTerm(t, dir) {
  const ids = state.byTerm[t];
  if (!ids.length) return;
  const cur = state.hits[state.current];
  let idx;
  if (cur && cur.term === t) {
    idx = (ids.indexOf(cur.id) + dir + ids.length) % ids.length;
  } else {
    const ref = cur ? cur.id : dir > 0 ? firstHitFromView() - 0.5 : lastHitBeforeView() + 0.5;
    if (dir > 0) {
      idx = ids.findIndex((id) => id > ref);
      if (idx < 0) idx = 0;
    } else {
      idx = -1;
      for (let k = ids.length - 1; k >= 0; k--) if (ids[k] < ref) { idx = k; break; }
      if (idx < 0) idx = ids.length - 1;
    }
  }
  jumpTo(ids[idx]);
}

function topVisiblePage() {
  const top = el.scroller.scrollTop;
  for (const p of state.pages) if (p.div.offsetTop + p.div.offsetHeight > top + 4) return p.num;
  return 1;
}
function firstHitFromView() {
  const pg = topVisiblePage();
  const h = state.hits.find((x) => x.page >= pg);
  return h ? h.id : 0;
}
function lastHitBeforeView() {
  const pg = topVisiblePage();
  for (let k = state.hits.length - 1; k >= 0; k--) if (state.hits[k].page <= pg) return k;
  return state.hits.length - 1;
}

async function jumpTo(id) {
  const hit = state.hits[id];
  if (!hit) return;
  state.current = id;
  updateNav();
  updateTermPositions();
  const ui = state.termUI[hit.term];
  if (ui?.open && ui.built <= state.byTerm[hit.term].indexOf(id)) {
    while (ui.built <= state.byTerm[hit.term].indexOf(id)) fillHitList(hit.term, true);
  }
  markActiveRow();
  el.termList.querySelector(".hit.active")?.scrollIntoView({ block: "nearest" });

  const p = state.pages[hit.page - 1];
  el.scroller.querySelectorAll(".hl.current").forEach((n) => n.classList.remove("current"));
  // Bring the page close first so it renders, then center the exact match.
  el.scroller.scrollTop = p.div.offsetTop - el.scroller.clientHeight / 3;
  await renderPage(p);
  if (state.current !== id) return;
  const marks = p.div.querySelectorAll(`.hl[data-hit="${id}"]`);
  marks.forEach((m) => m.classList.add("current"));
  if (marks[0]) {
    const r = marks[0].getBoundingClientRect();
    const s = el.scroller.getBoundingClientRect();
    el.scroller.scrollTop += r.top - s.top - s.height / 2 + r.height / 2;
    // Keep the page centered in the view so it doesn't slide sideways between matches.
    // Only when zoomed in past the window and the match would be cut off, move just enough to show it.
    const viewW = el.scroller.clientWidth;
    const pad = 40;
    let left = p.div.offsetLeft + p.div.offsetWidth / 2 - viewW / 2;
    const mLeft = r.left - s.left + el.scroller.scrollLeft; // match position within the document
    const mRight = mLeft + r.width;
    if (mLeft < left + pad) left = mLeft - pad;
    else if (mRight > left + viewW - pad) left = mRight - viewW + pad;
    el.scroller.scrollLeft = left;
  }
}

el.prevHit.addEventListener("click", () => stepAll(-1));
el.nextHit.addEventListener("click", () => stepAll(1));

document.addEventListener("keydown", (e) => {
  if (e.target.closest("textarea, input")) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "n" || e.key === "N") {
    e.preventDefault();
    const cur = state.hits[state.current];
    if (e.shiftKey && cur) stepTerm(cur.term, 1);
    else stepAll(1);
  } else if (e.key === "p" || e.key === "P") {
    e.preventDefault();
    const cur = state.hits[state.current];
    if (e.shiftKey && cur) stepTerm(cur.term, -1);
    else stepAll(-1);
  } else if (e.key === "+" || e.key === "=") {
    zoomBy(1.2);
  } else if (e.key === "-") {
    zoomBy(1 / 1.2);
  }
});

/* ------------------------------------------------------------------ */
/* Loading                                                            */
/* ------------------------------------------------------------------ */

function showMessage(nodes, { error = false } = {}) {
  el.message.className = "message" + (error ? " error" : "");
  el.message.replaceChildren(...nodes);
  el.message.hidden = false;
}

function openFileButton(label = "Open file") {
  return h("label", { className: "btn primary", htmlFor: "fileInput" }, label);
}

function titleFromUrl(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : u.hostname;
  } catch {
    return url;
  }
}

async function resetDocument() {
  state.token++;
  if (state.loadingTask) {
    const task = state.loadingTask;
    state.loadingTask = null;
    task.destroy().catch(() => {});
  }
  state.doc = null;
  state.pages = [];
  state.scanned = 0;
  state.scanDone = false;
  state.textScanDone = false;
  state.ocrFailed = false;
  state.hits = [];
  state.byTerm = state.terms.map(() => []);
  state.current = -1;
  el.pages.textContent = "";
  el.scroller.scrollTop = 0;
  buildTermList();
  updateNav();
}

async function loadDocument(source, title) {
  await resetDocument();
  const token = state.token;
  el.title.textContent = title;
  document.title = `${title} – PDF Term Finder`;
  showMessage([h("h1", {}, "Opening…"), h("p", { id: "loadProgress" }, title)]);
  el.scanStatus.textContent = "Loading PDF…";

  const task = pdfjsLib.getDocument({
    ...source,
    cMapUrl: LIB + "cmaps/",
    cMapPacked: true,
    standardFontDataUrl: LIB + "standard_fonts/",
    wasmUrl: LIB + "wasm/",
    iccUrl: LIB + "iccs/",
    isEvalSupported: false,
    enableXfa: false,
  });
  state.loadingTask = task;
  task.onProgress = ({ loaded, total }) => {
    const box = document.getElementById("loadProgress");
    if (box && total) box.textContent = `${Math.round((loaded / total) * 100)}% downloaded`;
  };
  task.onPassword = () => {
    showMessage([h("h1", {}, "This PDF is password protected"), h("p", {}, "Open it in Firefox's normal viewer instead.")], { error: true });
    task.destroy();
  };

  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    if (token !== state.token) return;
    console.error(err);
    el.scanStatus.textContent = "";
    const retry = source.url
      ? [
          h("p", {}, "The add-on couldn't download it directly. Save the PDF to your device, then open it here."),
          h("p", {}, h("a", { className: "btn", href: source.url }, "Open the original"), " ", openFileButton()),
        ]
      : [h("p", {}, openFileButton("Try another file"))];
    showMessage(
      [h("h1", {}, "Couldn't open this PDF"), h("p", { className: "small" }, String(err?.message || err)), ...retry],
      { error: true }
    );
    return;
  }
  if (token !== state.token) return;
  state.doc = doc;
  el.message.hidden = true;
  await scanDocument(doc, token);
}

async function scanDocument(doc, token) {
  const n = doc.numPages;
  const first = await doc.getPage(1);
  if (token !== state.token) return;
  state.scale = state.fit ? fitScale(first.getViewport({ scale: 1 }).width) : state.scale;
  updateZoomLabel();

  let lastPaint = 0;
  for (let i = 1; i <= n; i++) {
    let page;
    try {
      page = i === 1 ? first : await doc.getPage(i);
    } catch (err) {
      console.warn("Skipping page", i, err);
      continue;
    }
    if (token !== state.token) return;
    const vp = page.getViewport({ scale: 1 });
    const p = {
      num: i,
      w: vp.width,
      h: vp.height,
      userUnit: page.userUnit || 1,
      div: document.createElement("div"),
      textContent: null,
      pageText: null,
      hitIds: [],
      rendered: false,
    };
    p.div.className = "page";
    p.div.dataset.page = i;
    sizePage(p);
    el.pages.append(p.div);
    state.pages.push(p);

    try {
      const tc = await page.getTextContent();
      if (token !== state.token) return;
      p.textContent = tc;
      p.pageText = buildPageText(tc.items.filter((it) => it.str !== undefined));
      addPageHits(p);
      if (p.textLayer) applyHighlights(p);
    } catch (err) {
      console.warn("No text on page", i, err);
      p.pageText = buildPageText([]);
    }
    state.scanned = i;

    const now = performance.now();
    if (now - lastPaint > 150 || i === n) {
      lastPaint = now;
      el.scanStatus.textContent = `Scanning page ${i} of ${n}…`;
      updateTermCounts();
      updateNav();
      scheduleVisibleRender();
      await new Promise((r) => setTimeout(r)); // let the page stay responsive
      if (token !== state.token) return;
    }
  }
  state.textScanDone = true;
  if (state.settings.ocr !== false && state.pages.some((p) => needsOcr(p.pageText.text))) {
    await runOcr(token);
  } else {
    finishScan();
  }
}

function finishScan() {
  state.scanDone = true;
  const n = state.pages.length;
  const total = state.hits.length;
  const ocrPages = state.pages.filter((p) => p.ocr).length;
  const noText = state.pages.every((p) => !p.pageText || !p.pageText.text.trim());
  let msg = noText
    ? `${n} pages · no searchable text`
    : `${n} page${n === 1 ? "" : "s"} · ${total} match${total === 1 ? "" : "es"}`;
  if (ocrPages) msg += ` · ${ocrPages} image page${ocrPages === 1 ? "" : "s"} read with OCR`;
  if (state.ocrFailed) msg += " · OCR couldn't run";
  el.scanStatus.textContent = msg;
  updateTermCounts();
  updateNav();
}

/* ------------------------------------------------------------------ */
/* OCR for image-only pages                                           */
/* ------------------------------------------------------------------ */

// Reads pages that have no real text layer (only those), one at a time, in the background.
// Matches from each page appear as soon as it's read.
let ocrRunning = 0;
async function runOcr(token) {
  if (ocrRunning === token) return;
  ocrRunning = token;
  state.scanDone = false;
  state.ocrFailed = false;
  try {
    const todo = state.pages.filter((p) => !p.ocr && needsOcr(p.pageText.text));
    for (let k = 0; k < todo.length; k++) {
      if (token !== state.token || state.settings.ocr === false) return;
      const p = todo[k];
      el.scanStatus.textContent = `Reading image pages with OCR: ${k + 1} of ${todo.length} (page ${p.num})…`;
      updateTermCounts();
      updateNav();
      let lines;
      try {
        lines = await ocrPage(await state.doc.getPage(p.num));
      } catch (err) {
        console.error("OCR failed on page", p.num, err);
        if (k === 0) {
          state.ocrFailed = true; // the engine itself didn't start; don't keep trying
          break;
        }
        continue;
      }
      if (token !== state.token || state.settings.ocr === false) return;
      p.origPageText ??= p.pageText;
      p.ocrItemsList = ocrItems(lines);
      p.pageText = buildPageText(p.ocrItemsList);
      p.ocr = true;
      reindexHits();
      if (p.rendered) {
        unrenderPage(p); // re-draw with the OCR word layer so the matches can be highlighted
        scheduleVisibleRender();
      }
    }
  } finally {
    if (ocrRunning === token) ocrRunning = 0;
  }
  if (token === state.token && state.settings.ocr !== false) finishScan();
}

function removeOcrResults() {
  for (const p of state.pages) {
    if (!p.ocr) continue;
    p.pageText = p.origPageText;
    p.ocr = false;
    p.ocrItemsList = null;
    if (p.rendered) unrenderPage(p);
  }
  reindexHits();
  scheduleVisibleRender();
  if (state.textScanDone) finishScan();
}

/* ------------------------------------------------------------------ */
/* Rendering                                                          */
/* ------------------------------------------------------------------ */

// In Fit mode each page is fitted to the window separately, so a wide page (a map or plan sheet)
// is shrunk instead of making the whole document wider than the window.
function pageScale(p) {
  return state.fit ? fitScale(p.w) : state.scale;
}

function sizePage(p) {
  const scale = pageScale(p);
  p.scaleUsed = scale;
  p.div.style.width = `${Math.floor(p.w * scale)}px`;
  p.div.style.height = `${Math.floor(p.h * scale)}px`;
  p.div.style.setProperty("--scale-factor", String(scale));
  p.div.style.setProperty("--user-unit", String(p.userUnit));
}

function unrenderPage(p) {
  if (!p.rendered) return;
  p.gen = (p.gen || 0) + 1;
  p.renderTask?.cancel();
  p.textLayerTask?.cancel();
  p.renderTask = p.textLayerTask = null;
  p.textLayer = null;
  if (p.canvas) {
    p.canvas.width = p.canvas.height = 0;
    p.canvas.remove();
  }
  p.tlDiv?.remove();
  p.canvas = p.tlDiv = null;
  p.rendered = false;
  p.renderPromise = null;
}

function renderPage(p) {
  if (p.rendered) return p.renderPromise;
  p.rendered = true;
  const gen = (p.gen = (p.gen || 0) + 1);
  const alive = () => p.gen === gen;
  p.renderPromise = (async () => {
    const page = await state.doc.getPage(p.num);
    if (!alive()) return;
    const scale = p.scaleUsed ?? pageScale(p);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    let dpr = window.devicePixelRatio || 1;
    const maxDpr = Math.sqrt(MAX_CANVAS_PIXELS / (vp.width * vp.height));
    dpr = Math.max(0.5, Math.min(dpr, maxDpr));
    canvas.width = Math.floor(vp.width * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    canvas.style.width = `${Math.floor(vp.width)}px`;
    canvas.style.height = `${Math.floor(vp.height)}px`;
    p.canvas = canvas;
    p.div.prepend(canvas);
    p.renderTask = page.render({
      canvasContext: canvas.getContext("2d", { alpha: false }),
      viewport: vp,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
    });
    await p.renderTask.promise;
    if (!alive()) return;

    const tlDiv = document.createElement("div");
    tlDiv.className = "textLayer";
    p.div.append(tlDiv);
    p.tlDiv = tlDiv;
    if (p.ocr && p.ocrItemsList) {
      p.textLayer = buildOcrLayer(tlDiv, p.ocrItemsList, p.w, p.h, p.userUnit);
      applyHighlights(p);
      return;
    }
    const textContent = p.textContent || (await page.getTextContent());
    if (!alive()) return;
    const tl = new pdfjsLib.TextLayer({ textContentSource: textContent, container: tlDiv, viewport: vp });
    p.textLayerTask = tl;
    await tl.render();
    if (!alive()) return;
    p.textLayer = tl;
    applyHighlights(p);
  })().catch((err) => {
    if (err?.name !== "RenderingCancelledException" && err?.name !== "AbortException") console.error(err);
    if (alive() && !p.textLayer) unrenderPage(p);
  });
  return p.renderPromise;
}

// Wraps matched text inside the text layer's spans with colored <span class="hl">.
function applyHighlights(p) {
  const tl = p.textLayer;
  if (!tl || !p.pageText) return;
  const divs = tl.textDivs;
  const strs = tl.textContentItemsStr;

  // Restore any spans changed last time.
  for (const idx of p.hlItems || []) if (divs[idx]) divs[idx].textContent = strs[idx];
  p.hlItems = new Set();

  const byItem = new Map();
  for (const id of p.hitIds) {
    const hit = state.hits[id];
    for (const piece of matchToPieces(p.pageText, hit.start, hit.end)) {
      if (!byItem.has(piece.item)) byItem.set(piece.item, []);
      byItem.get(piece.item).push({ ...piece, id, term: hit.term });
    }
  }

  for (const [idx, pieces] of byItem) {
    const div = divs[idx];
    const str = strs[idx];
    if (!div || str === undefined) continue;
    pieces.sort((a, b) => a.start - b.start);
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const pc of pieces) {
      const start = Math.max(pc.start, pos);
      if (start >= pc.end) continue;
      if (start > pos) frag.append(str.slice(pos, start));
      const span = document.createElement("span");
      span.className = `hl c${pc.term % COLORS}`;
      span.dataset.hit = pc.id;
      span.textContent = str.slice(start, pc.end);
      frag.append(span);
      pos = pc.end;
    }
    if (pos < str.length) frag.append(str.slice(pos));
    div.textContent = "";
    div.append(frag);
    p.hlItems.add(idx);
  }

  if (state.current >= 0 && state.hits[state.current]?.page === p.num) {
    p.div.querySelectorAll(`.hl[data-hit="${state.current}"]`).forEach((m) => m.classList.add("current"));
  }
}

// Render pages near the screen; free pages far away (keeps phones from running out of memory).
let renderScheduled = false;
function scheduleVisibleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    if (!state.doc) return;
    const top = el.scroller.scrollTop;
    const h = el.scroller.clientHeight;
    for (const p of state.pages) {
      const y0 = p.div.offsetTop;
      const y1 = y0 + p.div.offsetHeight;
      if (y1 > top - h && y0 < top + 2 * h) renderPage(p);
      else if (y1 < top - 4 * h || y0 > top + 5 * h) unrenderPage(p);
    }
  });
}
el.scroller.addEventListener("scroll", scheduleVisibleRender, { passive: true });

/* ------------------------------------------------------------------ */
/* Zoom                                                               */
/* ------------------------------------------------------------------ */

function fitScale(pageWidth) {
  const avail = el.scroller.clientWidth - (isNarrow() ? 14 : 28);
  return Math.max(0.25, Math.min(4, avail / pageWidth));
}

function updateZoomLabel() {
  el.zoomFit.textContent = state.fit ? "Fit" : `${Math.round(state.scale * 100)}%`;
  el.zoomFit.title = state.fit ? "Fitted to width" : "Fit to width";
}

function setScale(scale, fit = false) {
  scale = Math.max(0.25, Math.min(5, scale));
  const fitChanged = state.fit !== fit;
  state.fit = fit;
  if (Math.abs(scale - state.scale) < 0.001 && !fitChanged) {
    updateZoomLabel();
    return;
  }
  // Keep the same spot of the document on screen.
  const ratio = el.scroller.scrollHeight ? (el.scroller.scrollTop + el.scroller.clientHeight / 2) / el.scroller.scrollHeight : 0;
  state.scale = scale;
  for (const p of state.pages) {
    unrenderPage(p);
    sizePage(p);
  }
  el.scroller.scrollTop = ratio * el.scroller.scrollHeight - el.scroller.clientHeight / 2;
  updateZoomLabel();
  scheduleVisibleRender();
}

function zoomBy(f) {
  setScale(state.scale * f, false);
}

function refit() {
  if (!state.pages.length) return;
  setScale(fitScale(state.pages[0].w), true);
}

el.zoomIn.addEventListener("click", () => zoomBy(1.2));
el.zoomOut.addEventListener("click", () => zoomBy(1 / 1.2));
el.zoomFit.addEventListener("click", refit);

let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state.fit) refit();
    else scheduleVisibleRender();
  }, 150);
});

/* ------------------------------------------------------------------ */
/* Opening files                                                      */
/* ------------------------------------------------------------------ */

async function openLocalFile(file) {
  if (!file) return;
  const data = new Uint8Array(await file.arrayBuffer());
  const url = new URL(location.href);
  url.search = "";
  history.replaceState(null, "", url);
  await loadDocument({ data }, file.name);
}

el.fileInput.addEventListener("change", () => {
  openLocalFile(el.fileInput.files[0]);
  el.fileInput.value = "";
});

let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
  dragDepth++;
  el.dropHint.hidden = false;
});
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) el.dropHint.hidden = true;
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  el.dropHint.hidden = true;
  const file = [...(e.dataTransfer?.files || [])].find((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
  if (file) openLocalFile(file);
});

/* ------------------------------------------------------------------ */
/* Start                                                              */
/* ------------------------------------------------------------------ */

async function start() {
  if (isNarrow()) setSheet("short");
  applySettings(await loadSettings());
  onSettingsChanged(applySettings);
  updateNav();

  const params = new URLSearchParams(location.search);
  const fileUrl = params.get("file");
  const localUrl = params.get("local");

  if (fileUrl) {
    await loadDocument({ url: fileUrl }, titleFromUrl(fileUrl));
  } else if (localUrl) {
    const name = titleFromUrl(localUrl);
    el.title.textContent = name;
    showMessage([
      h("h1", {}, "Choose the file to search it"),
      h("p", {}, "Firefox doesn't let add-ons read files from your device on their own. Pick ", h("strong", {}, name), " below and it opens here right away."),
      h("p", {}, openFileButton("Choose the file")),
    ]);
  }
  if (!state.terms.length) openEditor(true);
}

start().catch((err) => {
  console.error(err);
  showMessage([h("h1", {}, "Something went wrong"), h("p", { className: "small" }, String(err?.message || err))], { error: true });
});
