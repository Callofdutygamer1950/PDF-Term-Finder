// Tiny static file server for the tests: serves the repository root on a free local port.
const http = require("http");
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".pdf": "application/pdf", ".svg": "image/svg+xml", ".png": "image/png",
  ".wasm": "application/wasm", ".gz": "application/gzip", ".bcmap": "application/octet-stream", ".pfb": "application/octet-stream", ".icc": "application/octet-stream" };
exports.start = () => new Promise((resolve) => {
  const srv = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file.startsWith(ROOT)) return res.writeHead(403).end();
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end();
      res.writeHead(200, {
        "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
        // Same rules Firefox and Chrome apply to the extension's pages.
        "Content-Security-Policy": "script-src 'self' 'wasm-unsafe-eval'; object-src 'none';",
      });
      res.end(data);
    });
  });
  srv.listen(0, "127.0.0.1", () => resolve({ base: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() }));
});
