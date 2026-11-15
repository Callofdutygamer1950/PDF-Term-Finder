import {
  loadSettings,
  saveSettings,
  onSettingsChanged,
  activePreset,
  switchPreset,
  updatePreset,
  createPreset,
  deletePreset,
} from "../viewer/settings.js";
import { parseTerms } from "../viewer/matcher.js";

const $ = (id) => document.getElementById(id);
const form = $("form");
const terms = $("terms");
const presetSel = $("preset");
const presetName = $("presetName");
const wordEndings = $("wordEndings");
const insideWords = $("insideWords");
const ocr = $("ocr");
const status = $("status");
const delBtn = $("deletePreset");

let timer = 0;
function say(text) {
  status.textContent = text;
  clearTimeout(timer);
  timer = setTimeout(() => (status.textContent = ""), 3500);
}

let dirty = false;
terms.addEventListener("input", () => (dirty = true));
presetName.addEventListener("input", () => (dirty = true));

function show(s, { keepEdits = false } = {}) {
  presetSel.textContent = "";
  for (const p of s.presets) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.name;
    presetSel.append(o);
  }
  presetSel.value = s.activePreset;
  delBtn.disabled = s.presets.length <= 1;
  wordEndings.checked = !!s.wordEndings;
  insideWords.checked = !!s.insideWords;
  ocr.checked = s.ocr !== false;
  if (!keepEdits) {
    const p = activePreset(s);
    terms.value = p.termsText;
    presetName.value = p.name;
    dirty = false;
  }
}

presetSel.addEventListener("change", async () => {
  if (dirty && !window.confirm("Switch presets without saving your changes to this one?")) {
    presetSel.value = (await loadSettings()).activePreset;
    return;
  }
  dirty = false;
  await switchPreset(presetSel.value);
});

$("newPreset").addEventListener("click", async () => {
  const name = window.prompt("Name for the new preset:", "")?.trim();
  if (!name) return;
  dirty = false;
  await createPreset(name, "");
  say(`Created “${name}”. Add its terms, then Save.`);
  terms.focus();
});

delBtn.addEventListener("click", async () => {
  const s = await loadSettings();
  const p = activePreset(s);
  if (!window.confirm(`Delete the preset “${p.name}”?`)) return;
  dirty = false;
  if (await deletePreset(p.id)) say(`Deleted “${p.name}”.`);
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const s = await loadSettings();
  await saveSettings({ wordEndings: wordEndings.checked, insideWords: insideWords.checked, ocr: ocr.checked });
  await updatePreset(s.activePreset, { name: presetName.value, termsText: terms.value });
  dirty = false;
  const n = parseTerms(terms.value).length;
  say(`Saved ${n} term${n === 1 ? "" : "s"}. Open finder tabs update automatically.`);
});

onSettingsChanged((s) => show(s, { keepEdits: dirty }));
loadSettings().then((s) => show(s));
