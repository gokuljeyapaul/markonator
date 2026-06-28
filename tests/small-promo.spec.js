// Renders webstore/promo-small.html at exactly 440x280 and captures a PNG for
// the Chrome Web Store "Small promo tile". The PNG is converted to a no-alpha
// JPEG (store requirement) in CI via ffmpeg. Run via the `small-promo` project.

const { test } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "promo");

test.beforeAll(() => {
    fs.mkdirSync(OUT, { recursive: true });
});

test("generate 440x280 small promo tile", async ({ page }) => {
    await page.goto("/webstore/promo-small.html", { waitUntil: "load" });
    await page.waitForTimeout(250);
    await page.screenshot({
        path: path.join(OUT, "small.png"),
        clip: { x: 0, y: 0, width: 440, height: 280 },
    });
});
