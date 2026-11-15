// PDF Term Finder: toolbar button and right-click menu.
// Opens the current PDF (or a linked PDF) in the extension's own viewer.

// Chrome calls the extension API `chrome` (with promises in Manifest V3); Firefox calls it `browser`.
if (typeof globalThis.browser === "undefined") globalThis.browser = chrome;
const menus = browser.menus || browser.contextMenus; // Firefox: menus, Chrome: contextMenus

const VIEWER = browser.runtime.getURL("viewer/viewer.html");

function viewerUrlFor(pdfUrl) {
  if (!pdfUrl) return VIEWER;
  if (/^https?:/i.test(pdfUrl)) return `${VIEWER}?file=${encodeURIComponent(pdfUrl)}`;
  if (/^file:/i.test(pdfUrl)) return `${VIEWER}?local=${encodeURIComponent(pdfUrl)}`;
  return VIEWER;
}

async function openInViewer(tab, pdfUrl, { newTab = false } = {}) {
  const url = viewerUrlFor(pdfUrl);
  const isViewer = (tab?.url || "").startsWith(VIEWER);
  if (!newTab && tab && tab.id !== undefined && !isViewer && /^(https?|file):/i.test(tab.url || "")) {
    // Replace the PDF tab so the Back button returns to Firefox's normal viewer.
    await browser.tabs.update(tab.id, { url });
  } else {
    await browser.tabs.create({ url, active: true });
  }
}

browser.action.onClicked.addListener((tab) => {
  openInViewer(tab, tab.url).catch(console.error);
});

if (menus) {
  browser.runtime.onInstalled.addListener(() => {
    menus.removeAll().then(() => {
      menus.create({
        id: "ptf-open-link",
        title: "Open link in PDF Term Finder",
        contexts: ["link"],
      });
      menus.create({
        id: "ptf-open-page",
        title: "Find my terms in this PDF",
        contexts: ["page"],
      });
    });
  });

  menus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "ptf-open-link") {
      openInViewer(tab, info.linkUrl, { newTab: true }).catch(console.error);
    } else if (info.menuItemId === "ptf-open-page") {
      openInViewer(tab, info.pageUrl || tab?.url).catch(console.error);
    }
  });
}

// First install: open settings so the term list can be filled in.
browser.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") browser.runtime.openOptionsPage();
});
