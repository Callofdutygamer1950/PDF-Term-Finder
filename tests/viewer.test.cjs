const { chromium } = require("playwright");
const assert = require("node:assert/strict");
let BASE;
const stub = `
  (() => {
    const store = { termsText: "permit\\nland use\\ncontamin*\\nwom?n\\nzebra", wordEndings: true, insideWords: false };
    const listeners = [];
    globalThis.browser = { storage: {
      local: {
        get: async (keys) => Object.fromEntries(keys.filter(k => k in store).map(k => [k, store[k]])),
        set: async (patch) => { const changes = {}; for (const k in patch) { changes[k] = { newValue: patch[k] }; store[k] = patch[k]; } listeners.forEach(f => f(changes, "local")); },
      },
      onChanged: { addListener: (f) => listeners.push(f) },
    } };
  })();`;
(async () => {
  const srv = await require("./server.cjs").start();
  BASE = srv.base;
  const browser = await chromium.launch();
  for (const [label, viewport] of [["desktop", { width: 1280, height: 860 }], ["phone", { width: 390, height: 780 }]]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: label === "phone" ? 2 : 1 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.addInitScript(stub);
    await page.goto(`${BASE}/extension/viewer/viewer.html?file=${encodeURIComponent(BASE + "/tests/fixtures/sample.pdf")}`);
    await page.waitForFunction(() => /match/.test(document.getElementById("scanStatus").textContent) && !/Scanning/.test(document.getElementById("scanStatus").textContent), null, { timeout: 30000 });
    const counts = await page.$$eval(".term", (s) => s.map((x) => x.querySelector(".term-name").textContent + "=" + x.querySelector(".count").textContent));
    console.log(label, counts.join(", "), "|", await page.textContent("#scanStatus"));
    assert.deepEqual(counts, ["permit=3", "land use=2", "contamin*=3", "wom?n=2", "zebra=0"]);
    if (label === "phone") await page.click("#sheetHandle");
    // Jump to next "permit" twice via term nav
    await page.click(".term:nth-child(1) .term-nav button:last-child");
    await page.waitForSelector(".hl.current");
    await page.click(".term:nth-child(1) .term-nav button:last-child");
    await page.waitForTimeout(300);
    const cur = await page.$$eval(".hl.current", (n) => n.map((x) => x.textContent));
    console.log(label, "current after 2x next permit:", cur, await page.textContent(".term:nth-child(1) .tpos"), await page.textContent("#hitPos"));
    assert.deepEqual(cur, ["permits"]);
    // Expand contamin* list and click the 3rd hit (page 3)
    await page.click(".term:nth-child(3) .term-toggle");
    const rows = await page.$$eval(".term:nth-child(3) .hit", (n) => n.map((x) => x.textContent));
    console.log(label, rows);
    await page.click(".term:nth-child(3) .hit >> nth=2");
    await page.waitForTimeout(500);
    const cur2 = await page.$$eval(".hl.current", (n) => n.map((x) => x.textContent));
    assert.deepEqual(cur2, ["Contamination"]);
    // Phrase across lines highlighted in two pieces
    const pieces = await page.$$eval('.page[data-page="1"] .hl.c1', (n) => n.map((x) => x.textContent));
    console.log(label, "land use pieces on p1:", pieces);
    // Global next wraps
    await page.click("#nextHit");
    await page.waitForTimeout(300);
    console.log(label, "after global next:", await page.textContent("#hitPos"), await page.$$eval(".hl.current", (n) => n.map((x) => x.textContent)));
    // Change terms live through the editor
    if (label === "desktop") {
      await page.click("#editTermsBtn");
      await page.fill("#termsInput", "residents\n*ation");
      await page.click("#termEditor button[type=submit]");
      await page.waitForTimeout(500);
      const c2 = await page.$$eval(".term", (s) => s.map((x) => x.querySelector(".term-name").textContent + "=" + x.querySelector(".count").textContent));
      console.log("after edit:", c2);
      assert.deepEqual(c2, ["residents=1", "*ation=5"]);
      // Presets: existing list became "My terms", starter list exists, switching re-runs the search
      const opts = await page.$$eval("#presetSelect option", (o) => o.map((x) => x.textContent));
      console.log("presets:", opts);
      assert.deepEqual(opts, ["My terms", "ALPR & surveillance"]);
      await page.selectOption("#presetSelect", { label: "ALPR & surveillance" });
      await page.waitForTimeout(400);
      const names = await page.$$eval(".term-name", (n) => n.map((x) => x.textContent));
      assert.ok(names.includes("flock") && names.includes("alpr"), names.join(","));
      // Save the current list as a new preset, then switch back
      await page.click("#editTermsBtn");
      await page.fill("#presetName", "Contamination");
      await page.fill("#termsInput", "contamin*\nremediation");
      page.once("dialog", (d) => d.accept());
      await page.click("#saveAsNew");
      await page.waitForTimeout(400);
      const opts2 = await page.$$eval("#presetSelect option", (o) => o.map((x) => x.textContent));
      const sel = await page.$eval("#presetSelect", (x) => x.selectedOptions[0].textContent);
      const c3 = await page.$$eval(".term", (s) => s.map((x) => x.querySelector(".term-name").textContent + "=" + x.querySelector(".count").textContent));
      console.log("after save-as-new:", opts2, sel, c3);
      assert.deepEqual(opts2, ["My terms", "ALPR & surveillance", "Contamination"]);
      assert.equal(sel, "Contamination");
      assert.deepEqual(c3, ["contamin*=3", "remediation=1"]);
      await page.selectOption("#presetSelect", { label: "My terms" });
      await page.waitForTimeout(400);
      const c4 = await page.$$eval(".term-name", (n) => n.map((x) => x.textContent));
      assert.deepEqual(c4, ["residents", "*ation"]);
    }
    console.log(label, "errors:", errors);
    assert.equal(errors.length, 0);
    await page.close();
  }
  await browser.close();
  srv.close();
  console.log("browser tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
