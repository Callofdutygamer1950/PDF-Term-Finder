// Settings live in browser.storage.local: on this device only, never synced or uploaded.
//
// Term lists are kept as named presets. `termsText` always holds the active preset's list,
// so the matcher only ever needs to read that one field.
import { DEFAULT_SETTINGS } from "./matcher.js";

// Chrome calls the extension API `chrome` (with promises in Manifest V3); Firefox calls it `browser`.
if (typeof globalThis.browser === "undefined" && typeof chrome !== "undefined") globalThis.browser = chrome;

export const STARTER_PRESETS = [
  {
    id: "alpr-surveillance",
    name: "ALPR & surveillance",
    termsText: [
      "# License plate readers",
      "alpr",
      "lpr",
      "plate reader",
      "plate recognition",
      "plate camera",
      "plate scanner",
      "",
      "# Companies and products",
      "flock",
      "falcon",
      "raven",
      "condor",
      "axon",
      "fusus",
      "vigilant",
      "motorola solutions",
      "watchguard",
      "genetec",
      "rekor",
      "elsag",
      "leonardo",
      "ubicquia",
      "shotspotter",
      "soundthinking",
      "",
      "# Programs, data and policy",
      "real time crime center",
      "rtcc",
      "hot list",
      "hotlist",
      "surveillance",
      "drone as first responder",
      "data sharing",
      "retention period",
      "",
      "# Contracts",
      "sole source",
      "",
    ].join("\n"),
  },
];

const KEYS = [...Object.keys(DEFAULT_SETTINGS), "presets", "activePreset"];

const newId = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export async function loadSettings() {
  const stored = await browser.storage.local.get(KEYS);
  const s = { ...DEFAULT_SETTINGS, presets: null, activePreset: null, ...stored };

  // First run with presets: keep the list the user already had as "My terms", and add the starter list.
  if (!Array.isArray(s.presets) || !s.presets.length) {
    const presets = [];
    if (s.termsText.trim()) presets.push({ id: newId(), name: "My terms", termsText: s.termsText });
    for (const p of STARTER_PRESETS) presets.push({ ...p });
    const active = presets[0];
    Object.assign(s, { presets, activePreset: active.id, termsText: active.termsText });
    await browser.storage.local.set({ presets, activePreset: active.id, termsText: active.termsText });
  }
  if (!s.presets.some((p) => p.id === s.activePreset)) s.activePreset = s.presets[0].id;
  return s;
}

export async function saveSettings(patch) {
  await browser.storage.local.set(patch);
}

export function onSettingsChanged(callback) {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (KEYS.some((k) => k in changes)) loadSettings().then(callback);
  });
}

export function activePreset(s) {
  return s.presets.find((p) => p.id === s.activePreset) || s.presets[0];
}

export async function switchPreset(id) {
  const s = await loadSettings();
  const p = s.presets.find((x) => x.id === id);
  if (p) await saveSettings({ activePreset: p.id, termsText: p.termsText });
}

// Saves the list into the given preset (and renames it if a name is given), and makes it active.
export async function updatePreset(id, { name, termsText }) {
  const s = await loadSettings();
  const presets = s.presets.map((p) =>
    p.id === id ? { ...p, name: (name || p.name).trim() || p.name, termsText } : p
  );
  await saveSettings({ presets, activePreset: id, termsText });
}

export async function createPreset(name, termsText) {
  const s = await loadSettings();
  const preset = { id: newId(), name: uniqueName(s.presets, (name || "").trim() || "New preset"), termsText };
  await saveSettings({ presets: [...s.presets, preset], activePreset: preset.id, termsText });
  return preset.id;
}

export async function deletePreset(id) {
  const s = await loadSettings();
  if (s.presets.length <= 1) return false;
  const presets = s.presets.filter((p) => p.id !== id);
  const active = s.activePreset === id ? presets[0] : activePreset({ ...s, presets });
  await saveSettings({ presets, activePreset: active.id, termsText: active.termsText });
  return true;
}

function uniqueName(presets, name) {
  const taken = new Set(presets.map((p) => p.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) if (!taken.has(`${name} (${i})`.toLowerCase())) return `${name} (${i})`;
}
