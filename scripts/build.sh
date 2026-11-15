#!/usr/bin/env bash
# Builds both packages of PDF Term Finder from the one source folder:
#   dist/pdf-term-finder-<version>.zip         Firefox (desktop + Android)
#   dist/pdf-term-finder-chrome-<version>.zip  Chrome / Edge / Brave (desktop)
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=extension
WEBEXT=node_modules/.bin/web-ext
[ -x "$WEBEXT" ] || { echo "Run npm install first." >&2; exit 1; }
VERSION=$(node -p "require('./$SRC/manifest.json').version")
mkdir -p dist build
rm -f dist/pdf-term-finder-*.zip

# Firefox: the source folder as-is (PNG icons are only for Chrome).
$WEBEXT build -s "$SRC" -a build/firefox --overwrite-dest --ignore-files "icons/png/**" >/dev/null
mv build/firefox/pdf_term_finder-"$VERSION".zip dist/pdf-term-finder-"$VERSION".zip

# Chrome: same files, Chrome manifest (service worker, contextMenus, PNG icons).
rm -rf build/chrome && mkdir -p build/chrome
cp -r "$SRC"/. build/chrome/
rm build/chrome/icons/icon.svg
node - "$SRC/manifest.json" build/chrome/manifest.json <<'EOF'
const fs = require("fs");
const [src, out] = process.argv.slice(2);
const m = JSON.parse(fs.readFileSync(src, "utf8"));
const icons = { 16: "icons/png/icon-16.png", 32: "icons/png/icon-32.png", 48: "icons/png/icon-48.png", 128: "icons/png/icon-128.png" };
const chrome = {
  manifest_version: 3,
  name: m.name,
  version: m.version,
  description: m.description,
  minimum_chrome_version: "123",
  icons,
  action: { default_title: m.action.default_title, default_icon: icons },
  background: { service_worker: "background.js" },
  options_ui: m.options_ui,
  permissions: m.permissions.map((p) => (p === "menus" ? "contextMenus" : p)),
  host_permissions: m.host_permissions,
  content_security_policy: m.content_security_policy,
};
fs.writeFileSync(out, JSON.stringify(chrome, null, 2) + "\n");
EOF
(cd build/chrome && zip -qr -X "../../dist/pdf-term-finder-chrome-$VERSION.zip" .)
ls -la dist
