const { chromium } = require("playwright");
const assert = require("node:assert/strict");
let BASE;
const stub = `globalThis.browser={storage:{local:{get:async()=>({termsText:"alpr",wordEndings:true,insideWords:false}),set:async()=>{}},onChanged:{addListener(){}}}};`;
(async () => {
  const srv = await require("./server.cjs").start();
  BASE = srv.base;
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1400, height: 760 } });
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(stub);
  await page.goto(`${BASE}/extension/viewer/viewer.html?file=${encodeURIComponent(BASE + "/tests/fixtures/mixed.pdf")}`);
  await page.waitForFunction(() => / match/.test(document.getElementById("scanStatus").textContent));
  const info = () => page.evaluate(() => { const s = document.getElementById("scroller");
    const cur = document.querySelector(".hl.current"); const pg = cur?.closest(".page");
    const sr = s.getBoundingClientRect(), pr = pg?.getBoundingClientRect();
    return { pos: document.getElementById("hitPos").textContent, scrollLeft: Math.round(s.scrollLeft), overflowX: s.scrollWidth - s.clientWidth,
      pageCenterOffset: pr ? Math.round(pr.left + pr.width/2 - (sr.left + s.clientWidth/2)) : null }; });
  console.log("FIT mode");
  const fitLefts = new Set();
  for (let i = 0; i < 8; i++) { await page.click("#nextHit"); await page.waitForTimeout(250); const x = await info(); console.log(x); fitLefts.add(x.scrollLeft); assert.ok(Math.abs(x.pageCenterOffset) <= 2); }
  assert.equal((await info()).overflowX, 0, "no sideways scrolling in Fit");
  console.log("ZOOMED 200%");
  await page.click("#zoomIn"); await page.click("#zoomIn"); await page.click("#zoomIn"); await page.click("#zoomIn");
  await page.waitForTimeout(300);
  for (let i = 0; i < 8; i++) { await page.click("#nextHit"); await page.waitForTimeout(250); const x = await info();
    const vis = await page.evaluate(() => { const r = document.querySelector(".hl.current").getBoundingClientRect(), s = document.getElementById("scroller").getBoundingClientRect(); return r.left >= s.left && r.right <= s.left + document.getElementById("scroller").clientWidth; });
    console.log(x, "visible:", vis); assert.ok(vis); }
  assert.deepEqual(errors, []);
  await b.close();
  srv.close(); console.log("mixed-size tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
