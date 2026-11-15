const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("path");
const EXT = path.resolve(__dirname, "../build/chrome"); // run scripts/build.sh first
let BASE;
(async () => {
  const srv = await require("./server.cjs").start();
  BASE = srv.base;
  const ctx = await chromium.launchPersistentContext("", {
    channel: "chromium", headless: true, viewport: { width: 1400, height: 900 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const errors = [];
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker");
  sw.on("console", (m) => { if (m.type() === "error") errors.push("SW: " + m.text()); });
  const id = new URL(sw.url()).host;
  console.log("extension id:", id);
  await new Promise((r) => setTimeout(r, 1500));
  console.log("pages after install:", ctx.pages().map((p) => p.url().replace(id, "<id>")));
  assert.ok(ctx.pages().some((p) => p.url().includes("/options/options.html")), "settings page opens on install");
  const lastErr = await sw.evaluate(() => chrome.runtime.lastError?.message || null);
  console.log("menus api:", await sw.evaluate(() => typeof chrome.contextMenus.create), "lastError:", lastErr);

  // Toolbar button flow: a tab showing a PDF, then the action handler opens it in the viewer in that tab.
  const tab = await ctx.newPage();
  await tab.goto(`${BASE}/tests/fixtures/sample.pdf`).catch(() => {});
  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, `${BASE}/tests/fixtures/sample.pdf`);
  assert.ok(tabId, "found the PDF tab");
  await sw.evaluate(async (tid) => openInViewer(await chrome.tabs.get(tid), (await chrome.tabs.get(tid)).url), tabId);
  await tab.waitForURL(/viewer\/viewer\.html\?file=/, { timeout: 10000 });
  tab.on("pageerror", (e) => errors.push("PAGE: " + e));
  console.log("tab now:", tab.url().replace(id, "<id>"));
  // Fresh install has no terms: first preset is the starter list.
  await tab.waitForFunction(() => /match/.test(document.getElementById("scanStatus").textContent) && !/…/.test(document.getElementById("scanStatus").textContent), null, { timeout: 30000 });
  console.log("presets:", await tab.$$eval("#presetSelect option", (o) => o.map((x) => x.textContent)), "|", await tab.textContent("#scanStatus"));

  // Edit terms with real chrome.storage, then the big packet with OCR
  await tab.click("#editTermsBtn").catch(() => {});
  if (!(await tab.isVisible("#termsInput"))) await tab.click("#editTermsBtn");
  await tab.fill("#presetName", "Test");
  await tab.fill("#termsInput", "flock\nalpr\nZoom Meeting\nHoopla");
  await tab.click("#saveAsNew");
  await tab.waitForTimeout(500);
  const stored = await sw.evaluate(async () => { const s = await chrome.storage.local.get(null); return { presets: s.presets.map((p) => p.name), active: s.activePreset, terms: s.termsText }; });
  console.log("stored:", JSON.stringify(stored));
  assert.deepEqual(stored.presets, ["ALPR & surveillance", "Test"]);

  await tab.goto(`chrome-extension://${id}/viewer/viewer.html?file=${encodeURIComponent(BASE + "/tests/fixtures/cheney-city-council-packet-2026-11-10.pdf")}`);
  const t0 = Date.now();
  await tab.waitForFunction(() => /read with OCR|OCR couldn't/.test(document.getElementById("scanStatus").textContent), null, { timeout: 200000, polling: 1000 });
  console.log(((Date.now() - t0) / 1000).toFixed(0) + "s", await tab.textContent("#scanStatus"));
  const counts = await tab.$$eval(".term", (s) => s.map((x) => x.querySelector(".term-name").textContent + "=" + x.querySelector(".count").textContent));
  console.log(counts.join(", "));
  assert.deepEqual(counts, ["flock=6", "alpr=0", "Zoom Meeting=1", "Hoopla=10"]);
  await tab.click(".term:nth-child(4) .term-nav button:last-child");
  await tab.waitForTimeout(1200);
  console.log("current:", await tab.$$eval(".hl.current", (n) => n.map((x) => x.textContent)), await tab.textContent("#hitPos"));

  // Settings page
  const opt = await ctx.newPage();
  opt.on("pageerror", (e) => errors.push("OPT: " + e));
  await opt.goto(`chrome-extension://${id}/options/options.html`);
  await opt.waitForTimeout(500);
  console.log("options preset:", await opt.$eval("#preset", (x) => x.selectedOptions[0].textContent), "| terms:", (await opt.inputValue("#terms")).replace(/\n/g, ", "));
  console.log("errors:", errors);
  assert.deepEqual(errors, []);
  await ctx.close();
  srv.close();
  console.log("chrome tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
