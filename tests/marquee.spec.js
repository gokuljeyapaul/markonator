// Renders promo-marquee.html at exactly 1400x560 and captures a PNG for the
// Chrome Web Store "Marquee promo tile" (converted to no-alpha JPEG in CI via
// ffmpeg). Run via the `marquee` project.

const { test } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "promo");

test.beforeAll(() => {
    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(OUT, { recursive: true });
});

test("generate 1400x560 marquee promo tile", async ({ page }) => {
    await page.goto("/webstore/promo-marquee.html", { waitUntil: "load" });
    await page.waitForTimeout(250); // let the SVG/gradient paint
    await page.screenshot({
        path: path.join(OUT, "marquee.png"),
        clip: { x: 0, y: 0, width: 1400, height: 560 },
    });
});
