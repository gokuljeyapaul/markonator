// Helpers for the release-zip E2E tests: extract a zip with Python's stdlib
// (no native deps) and serve a directory over HTTP with Node's stdlib.

const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

function extractZip(zipPath) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-zip-"));
    // Python's zipfile is guaranteed present in CI and locally.
    execSync(
        `python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" ` +
            `"${zipPath}" "${dir}"`,
    );
    return dir;
}

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".woff2": "font/woff2",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
};

function serveDir(dir) {
    const server = http.createServer((req, res) => {
        let p = decodeURIComponent(req.url.split("?")[0]);
        if (p === "/") p = "/index.html";
        const full = path.join(dir, p);
        fs.readFile(full, (err, data) => {
            if (err) {
                res.statusCode = 404;
                res.end("not found");
                return;
            }
            res.setHeader("Content-Type", MIME[path.extname(full)] || "application/octet-stream");
            res.end(data);
        });
    });
    return new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const port = server.address().port;
            resolve({
                url: `http://127.0.0.1:${port}`,
                close: () => server.close(),
            });
        });
    });
}

function walk(dir, base = dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(full, base));
        else out.push(path.relative(base, full).split(path.sep).join("/"));
    }
    return out;
}

module.exports = { extractZip, serveDir, walk };
