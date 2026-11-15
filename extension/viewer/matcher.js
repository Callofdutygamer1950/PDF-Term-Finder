// Term matching for PDF Term Finder. No browser APIs here, so it can be tested on its own.
//
// Term syntax (one term per line):
//   permit          matches "permit", "Permit", "PERMITS" (simple endings only, see ENDINGS)
//   land use        phrases are allowed; any spacing or line break between the words matches
//   *ation          * stands for any number of letters or digits (part of a word)
//   wom?n           ? stands for exactly one letter or digit
//   # a note        lines starting with # are ignored

export const DEFAULT_SETTINGS = Object.freeze({
  termsText: "",
  wordEndings: true, // also match simple endings: -s, -es, -ed, -d, -ing, -er, -ers, -ly, 's
  insideWords: false, // when true, "art" also matches inside "start"
  ocr: true, // read image-only pages with OCR
});

const WORD_CHAR = "[\\p{L}\\p{N}]";
const ENDINGS = "(?:'s|’s|s|es|ed|d|ing|er|ers|ly)?";

export function parseTerms(text) {
  const seen = new Set();
  const terms = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const term = raw.trim().replace(/\s+/g, " ");
    if (!term || term.startsWith("#")) continue;
    if (!/[\p{L}\p{N}]/u.test(term)) continue; // needs at least one real letter/digit
    const key = term.normalize("NFKC").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  return terms;
}

function escapeChar(ch) {
  return /[.*+?^${}()|[\]\\\/-]/.test(ch) ? "\\" + ch : ch;
}

export function termToPattern(term, opts = DEFAULT_SETTINGS) {
  const words = term.normalize("NFKC").trim().split(/\s+/);
  const parts = words.map((word) => {
    let out = "";
    for (const ch of word) {
      if (ch === "*") out += WORD_CHAR + "*";
      else if (ch === "?") out += WORD_CHAR;
      else if (ch === "'" || ch === "’") out += "['’]";
      else if (/[-‐‑‒–—]/.test(ch)) out += "[-‐‑‒–—]";
      else out += escapeChar(ch);
    }
    return out;
  });
  let pattern = parts.join("\\s+");
  const last = words[words.length - 1];
  if (opts.wordEndings && !last.endsWith("*")) pattern += ENDINGS;
  if (!opts.insideWords) {
    pattern = `(?<!${WORD_CHAR})` + pattern + `(?!${WORD_CHAR})`;
  }
  return pattern;
}

// Builds one regex that finds every term in a single pass. Longer terms are tried first,
// so "land use permit" wins over "permit" where both would match.
export function buildMatcher(terms, opts = DEFAULT_SETTINGS) {
  if (!terms.length) return null;
  const order = terms
    .map((t, i) => ({ i, len: t.replace(/[*?]/g, "").length }))
    .sort((a, b) => b.len - a.len || a.i - b.i)
    .map((x) => x.i);
  const source = order.map((i) => `(${termToPattern(terms[i], opts)})`).join("|");
  return { regex: new RegExp(source, "giu"), order };
}

export function findMatches(text, matcher) {
  const out = [];
  if (!matcher || !text) return out;
  const re = matcher.regex;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    let group = 1;
    while (group < m.length && m[group] === undefined) group++;
    out.push({ term: matcher.order[group - 1], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

// Turns pdf.js text items into one searchable string, remembering where every character
// came from so matches can be highlighted on the page later.
// items: array of { str, hasEOL } (only items that have a `str`, in order)
export function buildPageText(items) {
  let text = "";
  const itemOf = [];
  const startOf = [];
  const endOf = [];
  const push = (s, item, start, end) => {
    for (let k = 0; k < s.length; k++) {
      itemOf.push(item);
      startOf.push(start);
      endOf.push(end);
    }
    text += s;
  };
  items.forEach((item, idx) => {
    const str = item.str || "";
    let off = 0;
    for (const cp of str) {
      const len = cp.length;
      let norm;
      if (cp === "­") norm = ""; // soft hyphen
      else if (/\s/.test(cp)) norm = " ";
      else norm = cp.normalize("NFKC");
      push(norm, idx, off, off + len);
      off += len;
    }
    if (item.hasEOL) push("\n", -1, 0, 0);
  });
  return {
    text,
    itemOf: Int32Array.from(itemOf),
    startOf: Int32Array.from(startOf),
    endOf: Int32Array.from(endOf),
  };
}

// Splits a match [start, end) in page text into per-item character ranges.
export function matchToPieces(page, start, end) {
  const pieces = [];
  let cur = null;
  for (let k = start; k < end; k++) {
    const item = page.itemOf[k];
    if (item < 0) continue;
    if (cur && cur.item === item) {
      cur.start = Math.min(cur.start, page.startOf[k]);
      cur.end = Math.max(cur.end, page.endOf[k]);
    } else {
      cur = { item, start: page.startOf[k], end: page.endOf[k] };
      pieces.push(cur);
    }
  }
  return pieces;
}

// Short context around a match: { before, match, after }, whitespace collapsed.
export function contextOf(text, start, end, radius = 80) {
  const clean = (s) => s.replace(/\s+/g, " ");
  let a = Math.max(0, start - radius);
  let b = Math.min(text.length, end + radius);
  // Try not to cut words in half.
  if (a > 0) {
    const sp = text.indexOf(" ", a);
    if (sp !== -1 && sp < start) a = sp + 1;
  }
  if (b < text.length) {
    const sp = text.lastIndexOf(" ", b);
    if (sp > end) b = sp;
  }
  return {
    before: (a > 0 ? "…" : "") + clean(text.slice(a, start)).trimStart(),
    match: clean(text.slice(start, end)),
    after: clean(text.slice(end, b)).trimEnd() + (b < text.length ? "…" : ""),
  };
}
