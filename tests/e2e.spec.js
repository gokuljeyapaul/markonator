const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const PLAN = fs.readFileSync(path.join(__dirname, "fixtures/plan.md"), "utf8");

const COMPLICATED = `# Plan
Some line.
<!-- markonator:thread id="t1" line="2" snippet="Some line." ts="x" resolved="true" -->
<!-- markonator:c id="c1" replyTo="" ts="x" -->
all done here
<!-- /markonator:c -->
<!-- /markonator:thread -->
Another line.
<!-- markonator:thread id="t2" line="6" snippet="Another line." ts="y" -->
<!-- markonator:c id="c2" replyTo="" ts="y" -->
please fix this
<!-- /markonator:c -->
<!-- markonator:c id="c3" replyTo="c2" ts="y" -->
agreed
<!-- /markonator:c -->
<!-- /markonator:thread -->`;

/* ---------------- Logic tests (via the ?test=1 hook) ---------------- */
test.describe("core logic", () => {
  test.beforeEach(async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push("PAGEERROR: " + (e.stack || e.message)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push("CONSOLE: " + m.text());
    });
    await page.goto("/index.html?test=1", { waitUntil: "load" });
    await page
      .waitForFunction(() => !!window.__markonator, null, { timeout: 8000 })
      .catch(() => {});
    const err = await page.evaluate(() => window.__markonator_err);
    if (err) throw new Error("test hook threw: " + err);
    const m = await page.evaluate(() => window.__markonator);
    if (!m) throw new Error("test hook did not expose __markonator. Page errors: " + JSON.stringify(errors));
  });

  test("parse -> serialize round-trips stably", async ({ page }) => {
    const r = await page.evaluate((src) => {
      const m = window.__markonator;
      const doc = m.parseMarkdown(src);
      const out = m.serializeDoc(doc);
      const out2 = m.serializeDoc(m.parseMarkdown(out));
      return { equal: out === out2, out };
    }, COMPLICATED);
    expect(r.equal).toBeTruthy();
    expect(r.out).toContain('markonator:thread id="t1"');
    expect(r.out).toContain('resolved="true"');
  });

  test("resolved flag parses and serializes", async ({ page }) => {
    const r = await page.evaluate((src) => {
      const m = window.__markonator;
      const doc = m.parseMarkdown(src);
      const threads = doc
        .filter((d) => d.kind === "thread")
        .map((d) => ({ id: d.thread.id, resolved: d.thread.resolved }));
      return { threads, out: m.serializeDoc(doc) };
    }, COMPLICATED);
    expect(r.threads).toEqual([
      { id: "t1", resolved: true },
      { id: "t2", resolved: false },
    ]);
    expect(r.out.match(/resolved="true"/g)).toHaveLength(1);
  });

  test("fileLineRanges aligns with the serialized file", async ({ page }) => {
    const r = await page.evaluate((src) => {
      const m = window.__markonator;
      const doc = m.parseMarkdown(src);
      const ranges = m.fileLineRanges(doc);
      const lines = m.serializeDoc(doc).split("\n");
      let ok = true;
      for (const rng of ranges) {
        if (rng.kind === "thread") {
          if (!lines[rng.start - 1].startsWith("<!-- markonator:thread"))
            ok = false;
          if (lines[rng.end - 1] !== "<!-- /markonator:thread -->") ok = false;
        }
      }
      return {
        ok,
        totalLines: lines.length,
        lastEnd: ranges[ranges.length - 1].end,
      };
    }, COMPLICATED);
    expect(r.ok).toBeTruthy();
    expect(r.lastEnd).toBe(r.totalLines);
  });

  test("agent prompt: saved-in-place mode references the file, no full content", async ({
    page,
  }) => {
    const r = await page.evaluate((src) => {
      const m = window.__markonator;
      m.state.doc = m.parseMarkdown(src);
      m.state.planPath = "/repos/foo/plan.md";
      m.state.fileHandle = {}; // truthy => in-place capable
      m.state.dirty = false;
      return m.buildAgentPrompt();
    }, COMPLICATED);
    expect(r).toContain("/repos/foo/plan.md");
    expect(r).toContain("between lines");
    expect(r).not.toContain("## Full document with comments");
  });

  test("agent prompt: not-saved mode includes the full document", async ({
    page,
  }) => {
    const r = await page.evaluate((src) => {
      const m = window.__markonator;
      m.state.doc = m.parseMarkdown(src);
      m.state.planPath = "plan.md";
      m.state.fileHandle = null;
      m.state.dirty = true;
      return m.buildAgentPrompt();
    }, COMPLICATED);
    expect(r).toContain("## Full document with comments");
    expect(r).toContain("markonator:thread");
  });

  test("agent prompt lists only unresolved threads and notes resolved ones", async ({
    page,
  }) => {
    const r = await page.evaluate((src) => {
      const m = window.__markonator;
      m.state.doc = m.parseMarkdown(src);
      m.state.planPath = "plan.md";
      m.state.fileHandle = {};
      m.state.dirty = false;
      return m.buildAgentPrompt();
    }, COMPLICATED);
    // unresolved thread t2's comments appear
    expect(r).toContain("please fix this");
    expect(r).toContain("agreed");
    // resolved thread t1's comment body does NOT appear in the to-address list
    expect(r).not.toContain("all done here");
    // resolved cleanup note present
    expect(r).toMatch(/1 thread\(s\) are already marked resolved/);
  });

  test("flexFind locates whitespace-flexible substrings", async ({ page }) => {
    const r = await page.evaluate(() => {
      const m = window.__markonator;
      return m.flexFind("hello   world  foo", "world foo");
    });
    expect(r).toBeTruthy();
    expect(r.start).toBeLessThan(r.end);
  });
});

/* ---------------- UI / end-to-end tests ---------------- */
test.describe("UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/index.html?test=1", { waitUntil: "load" });
    // load the plan via the paste area (no file picker needed)
    await page.locator("#pasteArea").fill(PLAN);
    await page.locator("#loadPasteBtn").click();
    await expect(page.locator("#doc")).toBeVisible();
    await expect(page.locator("#emptyState")).toBeHidden();
  });

  test("add a line comment via the floating +, then reply and resolve", async ({
    page,
  }) => {
    // hover a content block so the cursor-following + appears
    await page.locator(".block").first().hover();
    await page.waitForTimeout(150);
    await page.locator("#floatingAdd").click({ force: true });
    await expect(page.locator("#composer")).toBeVisible();
    await page.locator("#cText").fill("Use a typed enum like `THEME_LIGHT`.");
    await page.locator("#cSubmit").click();

    await expect(page.locator(".thread")).toHaveCount(1);
    await expect(page.locator(".thread .cbody code").first()).toHaveText(
      "THEME_LIGHT",
    );

    // reply on the comment
    await page.locator(".thread .act", { hasText: "Reply" }).first().click();
    await expect(page.locator("#composer")).toBeVisible();
    await page.locator("#cText").fill("Agreed, will switch.");
    await page.locator("#cSubmit").click();
    await expect(page.locator(".thread .comment.reply")).toHaveCount(1);

    // resolve the thread
    await page.locator(".thread .act", { hasText: "Resolve" }).first().click();
    await expect(page.locator(".thread.resolved")).toHaveCount(1);
    // reopen
    await page.locator(".thread .act", { hasText: "Reopen" }).first().click();
    await expect(page.locator(".thread.resolved")).toHaveCount(0);
  });

  test("download contains the markonator markup and round-trips", async ({
    page,
  }) => {
    // add a comment first
    await page.locator(".block").first().hover();
    await page.waitForTimeout(150);
    await page.locator("#floatingAdd").click({ force: true });
    await page.locator("#cText").fill("Split this step into two.");
    await page.locator("#cSubmit").click();
    await expect(page.locator(".thread")).toHaveCount(1);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#downloadBtn").click(),
    ]);
    const out = "/tmp/markonator-download.md";
    await download.saveAs(out);
    const content = fs.readFileSync(out, "utf8");
    expect(content).toContain("markonator:thread");
    expect(content).toContain("Split this step into two.");
    expect(content).toContain("Demo Plan");

    // and it re-parses cleanly
    const r = await page.evaluate((src) => {
      const m = window.__markonator;
      const doc = m.parseMarkdown(src);
      return {
        stable:
          m.serializeDoc(doc) ===
          m.serializeDoc(m.parseMarkdown(m.serializeDoc(doc))),
        threads: doc.filter((d) => d.kind === "thread").length,
      };
    }, content);
    expect(r.stable).toBeTruthy();
    expect(r.threads).toBe(1);
  });

  test("copy agent prompt puts a structured prompt on the clipboard", async ({
    page,
  }) => {
    await page.locator(".block").first().hover();
    await page.waitForTimeout(150);
    await page.locator("#floatingAdd").click({ force: true });
    await page.locator("#cText").fill("Use a typed enum.");
    await page.locator("#cSubmit").click();

    await page.locator("#agentPromptBtn").click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain("markonator:");
    expect(clip).toContain("Review threads to address");
    expect(clip).toContain("Use a typed enum.");
  });

  test("theme and font pickers apply to the document", async ({ page }) => {
    await page.locator("#themeBtn").click();
    await page.locator(".theme-opt", { hasText: "Nord" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "nord");

    await page.locator("#fontBtn").click();
    await page.locator(".font-opt", { hasText: "Lora" }).click();
    const ff = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--doc-font")
        .trim(),
    );
    expect(ff).toContain("Lora");
  });

  test("reset clears browser state and returns to the empty state", async ({
    page,
  }) => {
    await page.locator("#resetBtn").click();
    await page.locator("#modalActions button", { hasText: "Clear" }).click();
    await expect(page.locator("#emptyState")).toBeVisible();
    await expect(page.locator("#doc")).toBeHidden();
    await expect(page.locator("#saveBtn")).toBeDisabled();
  });
});
