# PDF Term Finder: setup guide

PDF Term Finder highlights your list of key terms in a PDF and gives you a side panel. The panel shows how many times each term appears, lists every match with the surrounding text, and has ‹ › buttons to jump to the previous or next match of that term. Everything runs inside Firefox on your device. Your terms are stored only in that browser, and the add-on never sends your terms or PDFs anywhere.

## 1. Try it on your laptop right now (temporary)

1. Unzip `pdf-term-finder-1.0.0.zip` into a folder.
2. In Firefox, go to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and pick the `manifest.json` file in that folder.
4. The settings page opens. Enter your terms (one per line) and click **Save**.

This is a test install, and Firefox removes it when it restarts. Step 2 makes it permanent.

## 2. Publish it so it installs permanently, including on Android

Firefox only installs add-ons for good when Mozilla has signed them, and Firefox for Android only installs add-ons that are listed publicly on Mozilla's add-on site. Publishing is free.

1. Go to https://addons.mozilla.org/developers/ and sign in or create a Mozilla account.
2. Click **Submit a New Add-on**.
3. When asked how to distribute it, choose **On this site**.
4. Upload `pdf-term-finder-1.0.0.zip` (the zip itself, not the unzipped folder).
5. Under compatible platforms, tick both **Firefox** and **Firefox for Android**.
6. When asked whether you need to submit source code, answer **No**. The add-on's own code is plain, readable JavaScript. The two bundled libraries are unmodified official releases from npm: Mozilla's pdf.js in `lib/pdfjs` and tesseract.js (the OCR engine) in `lib/tesseract`. Their exact versions are listed in each folder's `VERSION.txt`. If a reviewer asks, point them to those files.
7. Fill in the listing. Suggested values:
   - **Name:** PDF Term Finder. If that name is taken, add something distinctive, such as your group's name.
   - **Summary:** Highlights a list of key terms in PDFs and lets you jump between every match, with context. Runs entirely on your device.
   - **Category:** Search Tools
   - **License:** your choice (MIT is a common simple pick)
8. Submit. Automated checks usually finish within minutes to a few hours. A person at Mozilla may also review it later, and that review doesn't block people from installing it.
9. Once it's live, open the listing page in Firefox on your laptop and on your phone, and tap **Add to Firefox**. Remove the temporary copy from step 1 first.

To ship changes later, raise `"version"` in `manifest.json` (for example to `1.0.1`), zip the folder's contents again, and upload the zip as a new version on the same listing.

## Chrome, Edge and Brave (desktop)

Use `pdf-term-finder-chrome-1.1.0.zip` for Chrome. It's the same add-on, packaged for Chrome. Microsoft Edge and Brave can install it the same way.

**Install it yourself (free, stays installed):**
1. Unzip `pdf-term-finder-chrome-1.1.0.zip` into a folder you'll keep, such as `Documents\PDF Term Finder`. Chrome loads the add-on from that folder, so don't delete or move it.
2. Go to `chrome://extensions` (in Edge, `edge://extensions`).
3. Turn on **Developer mode** (top right in Chrome, left side in Edge).
4. Click **Load unpacked** and choose the folder from step 1, the one that contains `manifest.json`.
5. Click the puzzle-piece icon in the toolbar and pin **PDF Term Finder** so its button is always visible.

Unlike Firefox's temporary install, this survives restarts. Chrome may sometimes show a notice about developer-mode extensions; that's normal for add-ons installed this way.

To update later: unzip the new version over the same folder, then click the reload arrow on the add-on's card in `chrome://extensions`.

**Or publish it on the Chrome Web Store** (useful if other people in your group use Chrome):
1. Register at https://chrome.google.com/webstore/devconsole. Google charges a one-time $5 fee.
2. Click **New item** and upload `pdf-term-finder-chrome-1.1.0.zip`.
3. Under **Privacy**, say the add-on collects no user data. For the permissions, explain: *storage* saves the term lists on the device, *activeTab* reads the address of the PDF you're viewing, *contextMenus* adds the right-click option, and *all sites* lets it download the PDF you chose to open.
4. Choose **Unlisted** visibility if you only want people with the link to find it. Review usually takes a few days.

**Using it in Chrome:** open a PDF and click the toolbar button, the same as in Firefox. Right-clicking a link to a PDF also works. Chrome's own PDF viewer doesn't show add-on items when you right-click inside the PDF, so use the toolbar button there.

**Phones:** Chrome on Android and iPhone doesn't support extensions at all. On Android, use the Firefox version.

## 3. Everyday use

**Laptop**
- Open a PDF in Firefox as usual, then click the PDF Term Finder toolbar button. The PDF reopens with your terms highlighted. Firefox's Back button returns to the normal viewer.
- Right-click any link to a PDF and choose **Open link in PDF Term Finder**.
- For PDFs saved on your computer, click the toolbar button while the PDF is open and choose the same file when asked. You can also open the finder and drag a PDF onto it. Firefox doesn't let add-ons read files from your disk without your help.

**Android**
- Open the PDF in Firefox, then go to **⋮ menu → Extensions → PDF Term Finder**.
- If Firefox downloads the PDF instead of showing it, go to **⋮ → Extensions → PDF Term Finder → Settings → Open the finder**, then tap the open-file button.
- The term list is a sheet at the bottom of the screen. Tap the grey handle to make it bigger or smaller.

**Finding matches**
- The **‹ ›** buttons at the top go through every match in page order. The **‹ ›** buttons beside a term go through that term only, starting from where you are.
- Click a term's name to see every match with its page number and surrounding text, then click a row to jump there. The current match gets a red outline.
- Keyboard shortcuts: **N** goes to the next match and **P** to the previous one. Add **Shift** (Shift+N, Shift+P) to stay on the current term. **+** and **−** zoom.
- **Edit terms** in the panel changes the list on the spot. Changes are saved and apply to every open PDF.

**Presets (saved term lists)**
- The **Preset** menu at the top of the panel switches between saved lists. The PDF is searched again right away.
- The first time you open version 1.1, the list you already had is saved as **My terms**, and a starter **ALPR & surveillance** list is added.
- To change a preset, click **Edit terms**, change the name or terms, and click **Save and search**.
- To make a new preset, click **Edit terms**, type a new name and terms, and click **Save as new preset**. Your original preset stays as it was.
- **Delete this preset** is at the bottom of the editor. The settings page has the same controls.

**Image-only pages (OCR)**
- Some pages are only pictures: scans, photos, or agendas saved as images. The finder reads those pages with OCR (text recognition) after the normal scan, and only those pages. Pages that already have text are never OCR'd.
- Matches found this way are tagged **OCR** in the list, because recognition can misread a letter now and then. Handwriting is usually not readable.
- It runs entirely on your device. It can take a few seconds per image page, and longer on a phone. Turn it off with "Read pages that are only images (OCR)" in Edit terms or on the settings page.

## 4. How terms match

| You type | It finds |
|---|---|
| `permit` | permit, Permit, PERMITS, permit's (any upper/lower case, plus simple endings) |
| `land use` | "land use", including when the two words fall on different lines |
| `contamin*` | contaminated, contamination, contaminant… (`*` = any letters) |
| `*ation` | any word ending in "ation" |
| `wom?n` | woman, women (`?` = exactly one letter) |
| `# note` | nothing; lines starting with `#` are ignored |

There are three settings, available both in the panel and on the settings page:
- **Simple endings** (on by default): adds -s, -es, -ed, -d, -ing, -er, -ers, -ly and 's. Irregular forms like "stopped" need a wildcard (`stop*`).
- **Match inside longer words** (off by default): turn this on and `art` also finds "start". Leave it off and use `*` when you only want partial-word matches for certain terms.
- **OCR for image-only pages** (on by default): see above.

These settings apply to every preset; each preset only stores its name and term list.

## 5. Known limits

- **OCR is English-only** and can misread small, faint or skewed text. Handwriting is mostly missed.
- **Password-protected PDFs** won't open in the finder. Use Firefox's normal viewer for those.
- **PDFs behind a login**, or on sites that block direct downloads, may fail to load. The finder then shows an error with a link to the original. Save the PDF and use **Open file** instead.
- **Very large PDFs** are scanned page by page. Counts update as the scan goes, and you can start jumping before it finishes.
