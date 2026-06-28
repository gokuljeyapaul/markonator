// @ts-check
const { defineConfig, devices } = require("@playwright/test");

/**
 * Playwright E2E config for Markonator.
 * Serves the repo root over HTTP (so the service worker + module scripts load
 * in a secure context) and runs Chromium.
 */
module.exports = defineConfig({
    testDir: "./tests",
    fullyParallel: false,
    forbidRetry: false,
    retries: 1,
    workers: 1,
    reporter: [["list"], ["html", { open: "never" }]],
    timeout: 30000,
    expect: { timeout: 5000 },
    use: {
        baseURL: "http://127.0.0.1:8777",
        headless: true,
        permissions: ["clipboard-read", "clipboard-write"],
        ignoreHTTPSErrors: true,
    },
    webServer: {
        command: "python3 -m http.server 8777 --bind 127.0.0.1",
        url: "http://127.0.0.1:8777/index.html",
        reuseExistingServer: !process.env.CI,
        timeout: 30000,
    },
    projects: [
        {
            name: "chromium",
            testMatch: /e2e\.spec\.js/,
            use: { ...devices["Desktop Chrome"] },
        },
        {
            name: "screenshots",
            testMatch: /screenshots\.spec\.js/,
            retries: 0,
            use: {
                ...devices["Desktop Chrome"],
                viewport: { width: 1280, height: 800 },
                deviceScaleFactor: 2,
            },
        },
        {
            name: "zip",
            testMatch: /zip\.spec\.js/,
            use: { ...devices["Desktop Chrome"] },
        },
        {
            name: "extension",
            testMatch: /extension\.spec\.js/,
            retries: 0,
            use: { ...devices["Desktop Chrome"] },
        },
        {
            name: "marquee",
            testMatch: /marquee\.spec\.js/,
            retries: 0,
            use: {
                ...devices["Desktop Chrome"],
                viewport: { width: 1400, height: 560 },
                deviceScaleFactor: 1,
            },
        },
        {
            name: "small-promo",
            testMatch: /small-promo\.spec\.js/,
            retries: 0,
            use: {
                ...devices["Desktop Chrome"],
                viewport: { width: 440, height: 280 },
                deviceScaleFactor: 1,
            },
        },
    ],
});
