const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const PLAN = fs.readFileSync(
    path.join(__dirname, "fixtures", "shot-plan.md"),
    "utf8",
);

const OUT = path.join(__dirname, "..", "screenshots");

test.beforeAll(() => {
    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(OUT, { recursive: true });
});

/* Capture a coherent review story as a PNG sequence for the demo GIF,
   plus a full-page hero PNG for the README. */
test("capture demo screenshots", async ({ page }) => {
    const shot = (name) => page.screenshot({ path: path.join(OUT, name) });

    // 1 — empty / open state
    await page.goto("/index.html?test=1", { waitUntil: "load" });
    await page.waitForTimeout(250);
    await shot("shot-01.png");

    // 2 — plan loaded and rendered
    await page.locator("#pasteArea").fill(PLAN);
    await page.locator("#loadPasteBtn").click();
    await expect(page.locator("#doc")).toBeVisible();
    await page.waitForTimeout(250);
    await shot("shot-02.png");

    // 3 — hovering a block shows the cursor-following +
    await page.locator(".block").first().hover();
    await page.waitForTimeout(180);
    await shot("shot-03.png");

    // 4 — composer open with Markdown + live HTML preview
    await page.locator("#floatingAdd").click({ force: true });
    await expect(page.locator("#composer")).toBeVisible();
    await page.locator("#cText").fill(
        "The status field should be a typed enum, e.g. `NOTIF_UNREAD` or `NOTIF_READ`.",
    );
    await page.waitForTimeout(200);
    await shot("shot-04.png");

    // 5 — comment submitted, thread card inline
    await page.locator("#cSubmit").click();
    await expect(page.locator(".thread")).toHaveCount(1);
    await page.waitForTimeout(200);
    await shot("shot-05.png");

    // 6 — reply added, nested thread
    await page.locator(".thread .act", { hasText: "Reply" }).first().click();
    await expect(page.locator("#composer")).toBeVisible();
    await page.locator("#cText").fill("Good catch — I'll switch it to an enum.");
    await page.locator("#cSubmit").click();
    await expect(page.locator(".thread .comment.reply")).toHaveCount(1);
    await page.waitForTimeout(200);
    await shot("shot-06.png");

    // 7 — theme (Nord) + content font (Lora) applied
    await page.locator("#themeBtn").click();
    await page.locator(".theme-opt", { hasText: "Nord" }).click();
    await page.locator("#fontBtn").click();
    await page.locator(".font-opt", { hasText: "Lora" }).click();
    await page.waitForTimeout(250);
    await shot("shot-07.png");

    // 8 — copy agent prompt (toast visible)
    await page.locator("#agentPromptBtn").click();
    await page.waitForTimeout(120);
    await shot("shot-08.png");

    // hero — full-page final state for the README top image
    await page.screenshot({
        path: path.join(OUT, "marginalia-hero.png"),
        fullPage: true,
    });
});

