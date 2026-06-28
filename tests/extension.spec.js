// Gold-standard check: load the zip as an UNPACKED Chrome extension and run the
// app in the real extension context (background service worker, chrome.runtime).
// Extensions require headed Chrome, so this launches a persistent context with
// --load-extension. In CI, run under xvfb-run; locally a Chrome window appears.

const { test, expect, chromium } = require("@playwright/test");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { extractZip } = require("./lib");

const ZIP = process.env.MARKONATOR_ZIP || "extension/markonator-extension.zip";
const PLAN = `# Plan\n\n## Steps\n\n1. Do the thing.\n2. The field is a single string.\n`;

test("extension loads in Chrome and the page runs in the extension context", async () => {
    expect(fs.existsSync(ZIP), `zip not found: ${ZIP}`).toBe(true);
    const extDir = extractZip(ZIP);
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "mk-ext-"));

    const ctx = await chromium.launchPersistentContext(userData, {
        headless: false,
        args: [
            `--disable-extensions-except=${extDir}`,
            `--load-extension=${extDir}`,
            "--no-first-run",
            "--no-default-browser-check",
        ],
    });

    try {
        // The MV3 background service worker must register.
        let sw = ctx.serviceWorkers()[0];
        if (!sw) {
            sw = await ctx.waitForEvent("serviceworker", { timeout: 20000 });
        }
        // Prove we're inside the extension: get the extension page URL from the SW.
        const url = await sw.evaluate(() => chrome.runtime.getURL("index.html"));
        expect(url).toMatch(/^chrome-extension:\/\//);

        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e && (e.stack || e.message))));

        await page.goto(url, { waitUntil: "load" });
        await expect(page).toHaveTitle(/Markonator/);

        // extension mode: PWA install button is hidden (isExtension guard)
        await expect(page.locator("#installBtn")).toBeHidden();

        // load a plan and add a comment
        await page.locator("#pasteArea").fill(PLAN);
        await page.locator("#loadPasteBtn").click();
        await expect(page.locator("#doc")).toBeVisible();

        await page.locator(".block").first().hover();
        await page.waitForTimeout(180);
        await page.locator("#floatingAdd").click({ force: true });
        await page.locator("#cText").fill("Fix this step.");
        await page.locator("#cSubmit").click();
        await expect(page.locator(".thread")).toHaveCount(1);

        expect(errors, `page errors: ${JSON.stringify(errors)}`).toEqual([]);
    } finally {
        await ctx.close();
    }
});
