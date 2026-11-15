# PDF Term Finder

A Firefox and Chrome extension that highlights your list of key terms in any PDF, shows every match with the text around it, and takes you straight to each one. Everything runs on your device: PDFs and term lists are never uploaded.

It was built for volunteers reading through large batches of web-scraped public records (council packets, budgets, audits, contracts) for specific topics, such as license plate readers (ALPR) and surveillance technology.

**Website and privacy policy:** https://callofdutygamer1950.github.io/PDF-Term-Finder/ · [Privacy policy](https://callofdutygamer1950.github.io/PDF-Term-Finder/privacy/)

## Features

- Each term highlighted in its own color, with a side panel showing counts and every match in context
- Next/previous across all matches or within one term (keyboard: `N` / `P`, add `Shift` to stay on one term)
- Wildcards (`contamin*`, `wom?n`), phrases split across lines, optional simple word endings, `#` comment lines
- Saved presets for different term lists, including a starter "ALPR & surveillance" list
- OCR for image-only pages (scans, agendas saved as pictures); only pages with no text are OCR'd, and those matches are tagged
- Works in Firefox (desktop and Android) and Chrome, Edge and Brave (desktop)

## Install

Download the zip for your browser from [Releases](https://github.com/Callofdutygamer1950/PDF-Term-Finder/releases), then follow [SETUP-GUIDE.md](SETUP-GUIDE.md):

| Browser | File |
| --- | --- |
| Firefox (desktop, Android) | `pdf-term-finder-<version>.zip` |
| Chrome, Edge, Brave (desktop) | `pdf-term-finder-chrome-<version>.zip` |

## Repository layout

| Path | What it is |
| --- | --- |
| `extension/` | The extension's source; Firefox loads this folder as-is |
| `extension/lib/` | Bundled, unmodified third-party libraries: pdf.js and tesseract.js (see each `VERSION.txt`) |
| `scripts/build.sh` | Builds both zips into `dist/`; the Chrome package gets its own manifest |
| `tests/` | Automated tests, run in a headless browser |
| `docs/` | The GitHub Pages site, including the privacy policy |

## Development

Requires Node.js 18 or newer.

```bash
npm install
npx playwright install chromium   # browser for the tests
npm run build                     # dist/pdf-term-finder-<version>.zip and -chrome-<version>.zip
npm test                          # matching, viewer, layout and OCR tests
npm run test:chrome               # loads the Chrome build into Chromium and tests it end to end
npm run lint                      # Mozilla's add-on checker
```

To test by hand in Firefox, open `about:debugging#/runtime/this-firefox` and load `extension/manifest.json`. In Chrome, run the build, then use **Load unpacked** on `build/chrome`.

The OCR test uses a real public-records PDF, the City of Cheney, Washington city council packet for November 10, 2026 (`tests/fixtures/`).

## License

MIT, see [LICENSE](LICENSE). The bundled pdf.js and tesseract.js are Apache License 2.0; their license files are included next to them.
