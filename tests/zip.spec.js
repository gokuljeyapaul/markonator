// Verifies the Chrome Web Store zip artifact: structural conformance + that the
// bundled page actually runs in extension mode. Uses the built zip by default,
// or the zip at $MARKONATOR_ZIP (set by the release-verify workflow to the
// real published release asset).

const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const { extractZip, serveDir, walk } = require("./lib");

const ZIP = process.env.MARKONATOR_ZIP || "extension/markonator-extension.zip";

const PLAN = `# Plan\n\n## Steps\n\n1. Do the thing.\n2. The field is a single string.\n`;

/* ---------------- Conformance (no browser) ---------------- */
test.describe("release zip: conformance", () => {
    let dir;
    test.beforeAll(() => {
        expect(fs.existsSync(ZIP), `zip not found: ${ZIP}`).toBe(true);
        dir = extractZip(ZIP);
    });

    test("manifest.json is at the zip root, MV3, minimal permissions", () => {
        const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
        expect(m.manifest_version).toBe(3);
        expect(m.name).toBe("Markonator");
        expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(m.permissions).toEqual(["sidePanel"]);
    });

    test("every manifest-referenced file exists", () => {
        const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
        for (const sz of Object.keys(m.icons)) {
            expect(fs.existsSync(path.join(dir, m.icons[sz]))).toBe(true);
        }
        expect(fs.existsSync(path.join(dir, m.background.service_worker))).toBe(true);
        expect(fs.existsSync(path.join(dir, m.side_panel.default_path))).toBe(true);
        expect(fs.existsSync(path.join(dir, m.action.default_icon["16"]))).toBe(true);
    });

    test("runtime files are present", () => {
        for (const f of [
            "index.html",
            "app.js",
            "styles.css",
            "vendor/marked.min.js",
            "vendor/purify.min.js",
            "vendor/fonts/fonts.css",
        ]) {
            expect(fs.existsSync(path.join(dir, f)), `missing ${f}`).toBe(true);
        }
    });

    test("no unwanted files and no old name", () => {
        const all = walk(dir);
        const bad = all.filter(
            (n) =>
                n.startsWith("tests/") ||
                n.endsWith(".map") ||
                n.endsWith("README.md") ||
                n.includes("THIRD_PARTY") ||
                n.toLowerCase().includes("marginalia"),
        );
        expect(bad, `unwanted files: ${JSON.stringify(bad)}`).toEqual([]);
    });

    test("pages have no remote resources, no inline script, and set extension mode", () => {
        for (const p of ["index.html", "sidepanel.html"]) {
            const html = fs.readFileSync(path.join(dir, p), "utf8");
            expect(html, `${p} remote ref`).not.toMatch(/https?:\/\//);
            // no inline <script> with a body (allow <script src="...">)
            expect(html, `${p} inline script`).not.toMatch(/<script>[^<]/);
            expect(html, `${p} markonator-mode`).toContain("markonator-mode");
        }
    });

    test("app.js has the extension-mode guard and the markonator prefix", () => {
        const app = fs.readFileSync(path.join(dir, "app.js"), "utf8");
        expect(app).toContain("isExtension");
        expect(app).toContain("markonator:thread");
        expect(app).not.toMatch(/marginalia/);
    });
});

/* ---------------- Page runs in extension mode (browser) ---------------- */
test.describe("release zip: page runs in extension mode", () => {
    let dir, server;
    test.beforeAll(async () => {
        dir = extractZip(ZIP);
        server = await serveDir(dir);
    });
    test.afterAll(() => server && server.close());

    test("renders, loads a plan, adds a comment, hides install (extension mode)", async ({
        page,
    }) => {
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e && (e.stack || e.message))));

        await page.goto(`${server.url}/index.html`, { waitUntil: "load" });
        await expect(page).toHaveTitle(/Markonator/);

        // extension mode => the PWA install button is hidden (isExtension guard)
        await expect(page.locator("#installBtn")).toBeHidden();

        // load a plan via paste
        await page.locator("#pasteArea").fill(PLAN);
        await page.locator("#loadPasteBtn").click();
        await expect(page.locator("#doc")).toBeVisible();

        // add a comment via the cursor-following +
        await page.locator(".block").first().hover();
        await page.waitForTimeout(150);
        await page.locator("#floatingAdd").click({ force: true });
        await expect(page.locator("#composer")).toBeVisible();
        await page.locator("#cText").fill("Use a typed enum like `THEME_X`.");
        await page.locator("#cSubmit").click();
        await expect(page.locator(".thread")).toHaveCount(1);

        // download and verify the markonator markup is present
        const [download] = await Promise.all([
            page.waitForEvent("download"),
            page.locator("#downloadBtn").click(),
        ]);
        const out = "/tmp/markonator-zip-download.md";
        await download.saveAs(out);
        const content = fs.readFileSync(out, "utf8");
        expect(content).toContain("markonator:thread");
        expect(content).toContain("Use a typed enum");

        expect(errors, `page errors: ${JSON.stringify(errors)}`).toEqual([]);
    });
});
