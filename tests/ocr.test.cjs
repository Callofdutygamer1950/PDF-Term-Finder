const { chromium } = require("playwright");
const assert = require("node:assert/strict");
let BASE;
const stub = `globalThis.browser={storage:{local:{get:async()=>({termsText:"flock\\nalpr\\ncameras\\naxon\\nZoom Meeting\\nHoopla\\nLodging Tax",wordEndings:true,insideWords:false,ocr:true}),set:async()=>{}},onChanged:{addListener(){}}}};`;
(async () => {
  const srv = await require("./server.cjs").start();
  BASE = srv.base;
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const outside = [];
  await page.route("**/*", (r) => { const u = r.request().url(); if (u.startsWith(BASE) || u.startsWith("blob:") || u.startsWith("data:")) return r.continue(); outside.push(u); return r.abort(); });
  const errors = []; page.on("pageerror", (e) => errors.push(String(e))); 
  await page.addInitScript(stub);
  const t0 = Date.now(); 
  await page.goto(`${BASE}/extension/viewer/viewer.html?file=${encodeURIComponent(BASE + "/tests/fixtures/cheney-city-council-packet-2026-11-10.pdf")}`);
  for (let i = 0; ; i++) {
    const st = await page.evaluate(() => document.getElementById("scanStatus").textContent);
    if (/read with OCR|OCR couldn't/.test(st)) break;
    if (i > 100) throw new Error("timeout: " + st + " " + errors.join(" | "));
    await page.waitForTimeout(3000);
  }
  const counts = await page.$$eval(".term", (s) => s.map((x) => x.querySelector(".term-name").textContent + "=" + x.querySelector(".count").textContent));
  console.log(counts.join(", "));
  // open "Zoom Meeting" and "Hoopla" lists
  for (const n of [5, 6]) await page.click(`.term:nth-child(${n}) .term-toggle`);
  console.log(await page.$$eval(".term:nth-child(5) .hit, .term:nth-child(6) .hit", (r) => r.slice(0, 6).map((x) => x.textContent.replace(/\s+/g, " "))));
  await page.click(".term:nth-child(5) .hit >> nth=0");
  await page.waitForTimeout(1500);
  const cur = await page.$$eval(".hl.current", (n) => n.map((x) => x.textContent));
  console.log("current highlight:", cur);
  await page.click(".term:nth-child(6) .hit >> nth=0");
  await page.waitForTimeout(1500);
  console.log("current highlight:", await page.$$eval(".hl.current", (n) => n.map((x) => x.textContent)));
  console.log("outside requests:", outside, "errors:", errors);
  assert.deepEqual(counts, ["flock=6", "alpr=0", "cameras=2", "axon=0", "Zoom Meeting=1", "Hoopla=10", "Lodging Tax=33"]);
  assert.deepEqual(outside, []);
  assert.deepEqual(errors, []);
  await b.close();
  srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
