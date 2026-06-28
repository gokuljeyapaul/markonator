            "use strict";
            // When loaded inside the Chrome extension, the page sets
            // <meta name="markonator-mode" content="extension">. We use that to
            // skip PWA-only features (service worker + install prompt).
            const isExtension =
                document.querySelector('meta[name="markonator-mode"]') &&
                document.querySelector('meta[name="markonator-mode"]').content ===
                    "extension";
            // ?test=1 opts into the test hook and skips SW registration so
            // automated tests get a clean, cache-free page.
            const isTest =
                typeof URLSearchParams !== "undefined" &&
                new URLSearchParams(location.search).get("test") === "1";

            /* ---------- Review markup spec (versioned for forward-compat) ----------
               Inline anchor (wraps selected text on a content line):
                 text <!-- markonator:anchor id="a1" -->selected words<!-- /markonator:anchor --> text
               Thread block (on its own lines, right after the line/selection it refers to):
                 <!-- markonator:thread id="t1" line="5" anchor="a1" snippet="..." ts="ISO" -->
                 <!-- markonator:c id="c1" replyTo="" ts="ISO" -->
                 comment markdown body
                 <!-- /markonator:c -->
                 <!-- markonator:c id="c2" replyTo="c1" ts="ISO" -->
                 reply body
                 <!-- /markonator:c -->
                 <!-- /markonator:thread -->
               Line numbers in `line="..."` are 1-indexed and refer to the saved file.
            */

            const RE = {
                meta: /<!--\s*markonator:meta\s+version="(\d+)"\s*-->/,
                threadOpen:
                    /^<!--\s*markonator:thread\s+id="([^"]+)"([^>]*)\s*-->\s*$/,
                threadClose: /^<!--\s*\/markonator:thread\s*-->\s*$/,
                commentOpen:
                    /^<!--\s*markonator:c\s+id="([^"]+)"([^>]*)\s*-->\s*$/,
                commentClose: /^<!--\s*\/markonator:c\s*-->\s*$/,
                anchor: /<!--\s*markonator:anchor\s+id="([^"]+)"\s*-->([\s\S]*?)<!--\s*\/markonator:anchor\s*-->/g,
                anchorTag: /<!--\s*markonator:anchor\s+id="([^"]+)"\s*-->/,
            };

            function parseAttrs(s) {
                const out = {};
                const re = /(\w+)="([^"]*)"/g;
                let m;
                while ((m = re.exec(s))) out[m[1]] = m[2];
                return out;
            }

            /* ---------- In-memory document model ----------
               doc: array of items
                 {kind:'line', text: string, lineNo: number}        // one source line
                 {kind:'thread', thread: Thread, startLine, endLine} // occupies several source lines
               Thread: {id, line, anchor, snippet, ts, comments: [Comment]}
               Comment: {id, replyTo, ts, body}
            */
            function parseMarkdown(text) {
                const rawLines = text.replace(/\r\n?/g, "\n").split("\n");
                const doc = [];
                let lineNo = 1;
                let i = 0;
                // strip a legacy meta header if present so line numbers stay aligned
                // with the saved file (we no longer emit one).
                if (rawLines[0] && RE.meta.test(rawLines[0])) {
                    i = 1;
                }
                while (i < rawLines.length) {
                    const line = rawLines[i];
                    const tom = line.match(RE.threadOpen);
                    if (tom) {
                        const id = tom[1];
                        const attrs = parseAttrs(tom[2]);
                        const startLine = lineNo;
                        const comments = [];
                        i++;
                        lineNo++;
                        // walk until threadClose, collecting comments
                        let cur = null;
                        let curBody = [];
                        while (
                            i < rawLines.length &&
                            !RE.threadClose.test(rawLines[i])
                        ) {
                            const l = rawLines[i];
                            const com = l.match(RE.commentOpen);
                            if (com) {
                                if (cur) {
                                    cur.body = curBody.join("\n").trim();
                                    comments.push(cur);
                                }
                                cur = {
                                    id: com[1],
                                    replyTo: parseAttrs(com[2]).replyTo || "",
                                    ts: parseAttrs(com[2]).ts || "",
                                    body: "",
                                };
                                curBody = [];
                            } else if (RE.commentClose.test(l)) {
                                if (cur) {
                                    cur.body = curBody.join("\n").trim();
                                    comments.push(cur);
                                    cur = null;
                                    curBody = [];
                                }
                            } else if (cur) {
                                curBody.push(l);
                            } // ignore stray lines
                            i++;
                            lineNo++;
                        }
                        if (cur) {
                            cur.body = curBody.join("\n").trim();
                            comments.push(cur);
                        }
                        // consume close
                        if (
                            i < rawLines.length &&
                            RE.threadClose.test(rawLines[i])
                        ) {
                            i++;
                            lineNo++;
                        }
                        const endLine = lineNo - 1;
                        doc.push({
                            kind: "thread",
                            startLine,
                            endLine,
                            thread: {
                                id,
                                line: attrs.line || "",
                                anchor: attrs.anchor || "",
                                snippet: attrs.snippet || "",
                                ts: attrs.ts || "",
                                resolved: ["true"].includes(attrs.resolved),
                                comments,
                            },
                        });
                    } else {
                        doc.push({ kind: "line", text: line, lineNo });
                        i++;
                        lineNo++;
                    }
                }
                return doc;
            }

            function serializeDoc(doc) {
                const out = [];
                for (const item of doc) {
                    if (item.kind === "line") {
                        out.push(item.text);
                    } else {
                        const t = item.thread;
                        const attrs = [`id="${t.id}"`];
                        if (t.line) attrs.push(`line="${t.line}"`);
                        if (t.anchor) attrs.push(`anchor="${t.anchor}"`);
                        if (t.snippet)
                            attrs.push(`snippet="${escapeAttr(t.snippet)}"`);
                        if (t.ts) attrs.push(`ts="${t.ts}"`);
                        if (t.resolved) attrs.push(`resolved="true"`);
                        out.push(
                            `<!-- markonator:thread ${attrs.join(" ")} -->`,
                        );
                        for (const c of t.comments) {
                            const ca = [
                                `id="${c.id}"`,
                                `replyTo="${c.replyTo || ""}"`,
                                `ts="${c.ts || ""}"`,
                            ];
                            out.push(`<!-- markonator:c ${ca.join(" ")} -->`);
                            out.push(c.body);
                            out.push(`<!-- /markonator:c -->`);
                        }
                        out.push(`<!-- /markonator:thread -->`);
                    }
                }
                return out.join("\n");
            }
            function escapeAttr(s) {
                return String(s).replace(/"/g, "&quot;").replace(/\n/g, " ");
            }

            /* ---------- Anchor handling in line text ----------
               A line's text may contain inline anchor tags. We need to:
               - render them as <span class="anchor-mark">
               - allow adding a new anchor around a text selection within a line
            */
            function escapeHtml(s) {
                return String(s)
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;");
            }

            /* ---------- Rendering ---------- */
            function hasMarkdown() {
                return (
                    typeof marked !== "undefined" &&
                    typeof DOMPurify !== "undefined"
                );
            }

            function renderMd(text) {
                if (!text.trim()) return "";
                if (!hasMarkdown()) return `<pre>${escapeHtml(text)}</pre>`;
                try {
                    marked.setOptions({
                        gfm: true,
                        breaks: false,
                        headerIds: false,
                        mangle: false,
                    });
                    const html = marked.parse(text);
                    return DOMPurify.sanitize(html, {
                        ADD_ATTR: ["data-anchor", "target"],
                    });
                } catch (e) {
                    return `<pre>${escapeHtml(text)}</pre>`;
                }
            }

            function findBlockLines(items, idx) {
                // given an index in items that's a 'line', find the contiguous run of lines
                // (we render consecutive line items as one block)
                let start = idx;
                while (start > 0 && items[start - 1].kind === "line") start--;
                let end = idx;
                while (end < items.length - 1 && items[end + 1].kind === "line")
                    end++;
                return { start, end };
            }

            function renderDoc() {
                const docEl = document.getElementById("doc");
                docEl.innerHTML = "";
                const items = state.doc;
                let i = 0;
                while (i < items.length) {
                    if (items[i].kind === "line") {
                        // gather run
                        let j = i;
                        while (j < items.length && items[j].kind === "line")
                            j++;
                        const run = items.slice(i, j);
                        const startLine = run[0].lineNo;
                        const endLine = run[run.length - 1].lineNo;
                        // render run as markdown, but anchors inside lines need wrapping
                        // Strategy: render each line's anchors first (as placeholders), then marked on joined text.
                        // Simpler: join lines, replace anchors with sentinel tokens that survive marked, then restore.
                        const joined = run.map((it) => it.text).join("\n");
                        const block = document.createElement("div");
                        block.className = "block";
                        block.dataset.lineStart = startLine;
                        block.dataset.lineEnd = endLine;
                        const ln = document.createElement("div");
                        ln.className = "ln";
                        // line numbers
                        const nums = document.createElement("div");
                        nums.className = "num";
                        nums.textContent =
                            startLine === endLine
                                ? String(startLine)
                                : `${startLine}–${endLine}`;
                        ln.appendChild(nums);
                        block.appendChild(ln);
                        const md = document.createElement("div");
                        md.className = "md";
                        // Strip anchor tags (keep inner text) before markdown rendering; applyAnchorsInDom
                        // re-wraps the anchor inner text with highlight spans afterwards.
                        const textForMarked = joined.replace(
                            RE.anchor,
                            (m, id, inner) => inner,
                        );
                        let html;
                        if (hasMarkdown()) {
                            try {
                                marked.setOptions({
                                    gfm: true,
                                    breaks: false,
                                    headerIds: false,
                                    mangle: false,
                                });
                                html = DOMPurify.sanitize(
                                    marked.parse(textForMarked),
                                    { ADD_ATTR: ["data-anchor", "target"] },
                                );
                            } catch (e) {
                                html = `<pre>${escapeHtml(joined)}</pre>`;
                            }
                        } else {
                            html = `<pre>${escapeHtml(joined)}</pre>`;
                        }
                        md.innerHTML = html;
                        block.appendChild(md);
                        docEl.appendChild(block);
                        i = j;
                    } else {
                        // thread item
                        const card = renderThreadCard(items[i]);
                        docEl.appendChild(card);
                        i++;
                    }
                }
                // Re-apply anchors properly via DOM walk (robust approach)
                applyAnchorsInDom(docEl, items);
            }

            function applyAnchorsInDom(docEl, items) {
                // Walk text nodes; for each anchor id in source, the inner text is known.
                // We need source anchor ids and their inner text per line.
                // Build map anchor -> innerText from source lines
                const anchorMap = {};
                for (const it of items) {
                    if (it.kind === "line") {
                        let m;
                        RE.anchor.lastIndex = 0;
                        while ((m = RE.anchor.exec(it.text))) {
                            anchorMap[m[1]] = m[2];
                        }
                    }
                }
                // For each anchor id, find its text in rendered DOM and wrap. This is approximate.
                // We rely on the fact that marked preserves text content; we search for innerText and wrap first occurrence.
                const walker = document.createTreeWalker(
                    docEl,
                    NodeFilter.SHOW_TEXT,
                );
                const textNodes = [];
                let n;
                while ((n = walker.nextNode())) {
                    if (
                        n.parentNode.classList &&
                        n.parentNode.classList.contains("ln")
                    )
                        continue;
                    textNodes.push(n);
                }
                for (const [id, inner] of Object.entries(anchorMap)) {
                    const target = inner.trim();
                    if (!target) continue;
                    // find a text node containing target
                    for (const tn of textNodes) {
                        const idx = tn.nodeValue.indexOf(target);
                        if (idx >= 0) {
                            const range = document.createRange();
                            range.setStart(tn, idx);
                            range.setEnd(tn, idx + target.length);
                            const span = document.createElement("span");
                            span.className = "anchor-mark";
                            span.dataset.anchor = id;
                            span.title = `Anchored by a thread`;
                            range.surroundContents(span);
                            span.addEventListener("click", () => {
                                const t = findThreadByAnchor(id);
                                if (t) {
                                    const el = document.querySelector(
                                        `[data-thread="${t.id}"]`,
                                    );
                                    if (el)
                                        el.scrollIntoView({
                                            behavior: "smooth",
                                            block: "center",
                                        });
                                }
                            });
                            break;
                        }
                    }
                }
            }

            function renderThreadCard(item) {
                const t = item.thread;
                const card = document.createElement("div");
                card.className = "thread" + (t.anchor ? " anchor-thread" : "");
                if (t.resolved) card.classList.add("resolved");
                card.dataset.thread = t.id;
                card.dataset.lineRef = t.line;
                const head = document.createElement("div");
                head.className = "thread-head";
                const badge = document.createElement("span");
                badge.className = "badge";
                badge.textContent = t.anchor ? "Selection" : `Line ${t.line}`;
                head.appendChild(badge);
                if (t.snippet) {
                    const sn = document.createElement("span");
                    sn.className = "meta";
                    sn.textContent =
                        "“" +
                        (t.snippet.length > 60
                            ? t.snippet.slice(0, 60) + "…"
                            : t.snippet) +
                        "”";
                    head.appendChild(sn);
                }
                const sp = document.createElement("span");
                sp.className = "spacer";
                head.appendChild(sp);
                const res = document.createElement("button");
                res.className = "act resolve" + (t.resolved ? " on" : "");
                res.textContent = t.resolved ? "Reopen" : "Resolve";
                res.title = t.resolved ? "Mark as not done" : "Mark as done";
                res.onclick = () => toggleResolve(t.id);
                head.appendChild(res);
                const del = document.createElement("button");
                del.className = "act del";
                del.textContent = "Delete thread";
                del.title = "Delete entire thread";
                del.onclick = () => confirmDeleteThread(t.id);
                head.appendChild(del);
                card.appendChild(head);
                if (t.snippet && t.snippet.length > 60) {
                    const sn = document.createElement("div");
                    sn.className = "thread-snippet";
                    sn.textContent = t.snippet;
                    card.appendChild(sn);
                }
                // render comments as flat list with reply indentation based on replyTo chain
                const byId = {};
                t.comments.forEach((c) => (byId[c.id] = c));
                // build tree
                const roots = t.comments.filter(
                    (c) => !c.replyTo || !byId[c.replyTo],
                );
                function renderComment(c, depth) {
                    const wrap = document.createElement("div");
                    wrap.className = "comment" + (depth > 0 ? " reply" : "");
                    const meta = document.createElement("div");
                    meta.className = "cmeta";
                    const cid = document.createElement("span");
                    cid.className = "cid";
                    cid.textContent = "#" + c.id;
                    meta.appendChild(cid);
                    const sp = document.createElement("span");
                    sp.className = "spacer";
                    meta.appendChild(sp);
                    const reply = document.createElement("button");
                    reply.className = "act";
                    reply.textContent = "Reply";
                    reply.onclick = () =>
                        openComposer({
                            type: "reply",
                            threadId: t.id,
                            replyTo: c.id,
                        });
                    meta.appendChild(reply);
                    const edit = document.createElement("button");
                    edit.className = "act";
                    edit.textContent = "Edit";
                    edit.onclick = () =>
                        openComposer({
                            type: "edit",
                            threadId: t.id,
                            commentId: c.id,
                            initial: c.body || "",
                        });
                    meta.appendChild(edit);
                    const del = document.createElement("button");
                    del.className = "act del";
                    del.textContent = "Delete";
                    del.onclick = () => confirmDeleteComment(t.id, c.id);
                    meta.appendChild(del);
                    wrap.appendChild(meta);
                    const body = document.createElement("div");
                    body.className = "cbody";
                    const md = document.createElement("div");
                    md.className = "md";
                    md.innerHTML = renderMd(c.body || "");
                    body.appendChild(md);
                    wrap.appendChild(body);
                    const kids = t.comments.filter((x) => x.replyTo === c.id);
                    for (const k of kids)
                        wrap.appendChild(renderComment(k, depth + 1));
                    return wrap;
                }
                for (const r of roots) card.appendChild(renderComment(r, 0));
                // reply-to-thread button
                const foot = document.createElement("div");
                foot.style.marginTop = "6px";
                const rAll = document.createElement("button");
                rAll.className = "act";
                rAll.textContent = "↪ Reply to thread";
                rAll.onclick = () =>
                    openComposer({
                        type: "reply",
                        threadId: t.id,
                        replyTo: "",
                    });
                foot.appendChild(rAll);
                card.appendChild(foot);
                return card;
            }

            function findThreadByAnchor(anchorId) {
                for (const it of state.doc)
                    if (it.kind === "thread" && it.thread.anchor === anchorId)
                        return it.thread;
                return null;
            }

            /* ---------- State ---------- */
            const state = {
                doc: [], // parsed items
                fileName: "untitled.md",
                planPath: "", // full path used in agent prompts (user-set)
                fileHandle: null, // File System Access API handle
                dirty: false,
                nextThreadId: 1,
                nextCommentId: 1,
                nextAnchorId: 1,
                composer: null, // current composer context
            };

            function recomputeIds() {
                let tt = 1,
                    cc = 1,
                    aa = 1;
                for (const it of state.doc) {
                    if (it.kind === "thread") {
                        tt = Math.max(
                            tt,
                            parseInt(it.thread.id.replace(/\D/g, "")) || tt,
                        );
                        for (const c of it.thread.comments)
                            cc = Math.max(
                                cc,
                                parseInt(c.id.replace(/\D/g, "")) || cc,
                            );
                        if (it.thread.anchor)
                            aa = Math.max(
                                aa,
                                parseInt(it.thread.anchor.replace(/\D/g, "")) ||
                                    aa,
                            );
                    }
                }
                state.nextThreadId = tt + 1;
                state.nextCommentId = cc + 1;
                state.nextAnchorId = aa + 1;
            }

            /* ---------- IndexedDB persistence ---------- */
            const DB_NAME = "markonator";
            const STORE = "state";
            function idb() {
                return new Promise((res, rej) => {
                    const req = indexedDB.open(DB_NAME, 1);
                    req.onupgradeneeded = () => {
                        req.result.createObjectStore(STORE);
                    };
                    req.onsuccess = () => res(req.result);
                    req.onerror = () => rej(req.error);
                });
            }
            async function idbGet(key) {
                const db = await idb();
                return new Promise((res, rej) => {
                    const tx = db
                        .transaction(STORE, "readonly")
                        .objectStore(STORE)
                        .get(key);
                    tx.onsuccess = () => res(tx.result);
                    tx.onerror = () => rej(tx.error);
                });
            }
            async function idbSet(key, val) {
                const db = await idb();
                return new Promise((res, rej) => {
                    const tx = db
                        .transaction(STORE, "readwrite")
                        .objectStore(STORE)
                        .put(val, key);
                    tx.onsuccess = () => res();
                    tx.onerror = () => rej(tx.error);
                });
            }
            async function idbClear() {
                const db = await idb();
                return new Promise((res, rej) => {
                    const tx = db
                        .transaction(STORE, "readwrite")
                        .objectStore(STORE)
                        .clear();
                    tx.onsuccess = () => res();
                    tx.onerror = () => rej(tx.error);
                });
            }

            async function persistState() {
                await idbSet("doc", serializeDoc(state.doc));
                await idbSet("fileName", state.fileName);
                await idbSet("planPath", state.planPath || "");
                await idbSet("hasFile", !!state.fileHandle);
                // We can't persist fileHandle reliably across sessions in all browsers; keep name only.
            }

            async function loadPersisted() {
                const saved = await idbGet("doc");
                if (saved && typeof saved === "string" && saved.trim()) {
                    state.doc = parseMarkdown(saved);
                    state.fileName =
                        (await idbGet("fileName")) || "untitled.md";
                    state.planPath = (await idbGet("planPath")) || "";
                    recomputeIds();
                    showDoc();
                    return true;
                }
                return false;
            }

            /* ---------- File handling ---------- */
            function supportsFSA() {
                return "showOpenFilePicker" in window;
            }

            async function openFile() {
                if (supportsFSA()) {
                    try {
                        const [handle] = await window.showOpenFilePicker({
                            types: [
                                {
                                    description: "Markdown",
                                    accept: {
                                        "text/markdown": [
                                            ".md",
                                            ".markdown",
                                            ".txt",
                                        ],
                                    },
                                },
                            ],
                        });
                        const file = await handle.getFile();
                        const text = await file.text();
                        state.fileHandle = handle;
                        loadText(text, file.name);
                        toast(`Opened ${file.name}`);
                    } catch (e) {
                        if (e.name === "AbortError") return;
                        fallbackInput();
                    }
                } else {
                    fallbackInput();
                }
            }

            function fallbackInput() {
                const inp = document.createElement("input");
                inp.type = "file";
                inp.accept = ".md,.markdown,.txt,text/markdown";
                inp.onchange = async () => {
                    const f = inp.files[0];
                    if (!f) return;
                    loadText(await f.text(), f.name);
                    toast(`Opened ${f.name}`);
                };
                inp.click();
            }

            function loadText(text, name) {
                state.doc = parseMarkdown(text);
                state.fileName = name;
                state.planPath = name;
                state.fileHandle = arguments[2] || state.fileHandle;
                state.dirty = false;
                recomputeIds();
                showDoc();
                persistState();
                updateFileTag();
            }

            async function saveFile(silent) {
                const out = serializeDoc(state.doc);
                if (state.fileHandle) {
                    try {
                        const w = await state.fileHandle.createWritable();
                        await w.write(out);
                        await w.close();
                        state.dirty = false;
                        updateFileTag();
                        if (!silent) toast("Saved to file ✓");
                        return true;
                    } catch (e) {
                        if (
                            e.name === "NotAllowedError" ||
                            e.name === "SecurityError"
                        ) {
                            if (!silent)
                                toast("Save blocked — using download instead");
                            return downloadFile();
                        }
                        if (!silent) toast("Save failed: " + e.message);
                        return false;
                    }
                }
                return downloadFile(silent);
            }

            function downloadFile(silent) {
                const out = serializeDoc(state.doc);
                const blob = new Blob([out], { type: "text/markdown" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = state.fileName || "review.md";
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                state.dirty = false;
                updateFileTag();
                if (!silent) toast("Downloaded ✓");
                return true;
            }

            /* ---------- Copy agent prompt ---------- */
            const agentPromptBtn = document.getElementById("agentPromptBtn");

            // Map each doc item to its 1-indexed file line range, matching serializeDoc.
            function fileLineRanges(doc) {
                let lineNo = 1;
                const ranges = [];
                for (const it of doc) {
                    if (it.kind === "line") {
                        ranges.push({
                            kind: "line",
                            start: lineNo,
                            end: lineNo,
                        });
                        lineNo++;
                    } else {
                        const t = it.thread;
                        const start = lineNo;
                        lineNo++; // thread open
                        for (const c of t.comments) {
                            lineNo++; // c open
                            // serializeDoc always writes the body line (even if empty),
                            // so an empty body still occupies one line.
                            const bodyLines = (c.body || "").split("\n").length;
                            lineNo += bodyLines;
                            lineNo++; // c close
                        }
                        lineNo++; // thread close
                        ranges.push({
                            kind: "thread",
                            start: start,
                            end: lineNo - 1,
                            thread: t,
                        });
                    }
                }
                return ranges;
            }

            function buildAgentPrompt() {
                const savedInPlace = !!state.fileHandle && !state.dirty;
                const planPath = state.planPath || state.fileName;
                const ranges = fileLineRanges(state.doc);
                const threadRanges = ranges.filter((r) => r.kind === "thread");
                let spanStart = null,
                    spanEnd = null;
                threadRanges.forEach((r) => {
                    if (spanStart === null || r.start < spanStart)
                        spanStart = r.start;
                    if (spanEnd === null || r.end > spanEnd) spanEnd = r.end;
                });
                const unresolvedRanges = threadRanges.filter((r) => !r.thread.resolved);
                const resolvedCount = threadRanges.length - unresolvedRanges.length;
                const spanStr =
                    spanStart !== null ? spanStart + "–" + spanEnd : "(none)";

                const L = [];
                if (savedInPlace) {
                    L.push(
                        "The plan file at `" +
                            planPath +
                            "` has been updated with inline review comments in the `markonator:` format. They are NOT part of the original plan — they are reviewer feedback. Open that file, address each thread, then strip the comment markup and return the cleaned-up plan.",
                    );
                    L.push("");
                    L.push(
                        "Do NOT reproduce the whole file from this prompt — read it from disk at `" +
                            planPath +
                            "`, edit in place, and return the revised version.",
                    );
                    L.push("");
                    L.push(
                        "The `markonator:` review blocks appear in the file roughly between lines " +
                            spanStr +
                            ".",
                    );
                    L.push("");
                } else {
                    L.push(
                        "A Markdown plan is being reviewed. The review comments are in the `markonator:` format and have NOT yet been written back to the source file, so the full document with comments is included below. Address each thread, then remove the comment markup and return the cleaned-up plan.",
                    );
                    L.push("");
                }

                L.push("## Comment format");
                L.push(
                    "Review comments are embedded as HTML comments prefixed with `markonator:`. They are NOT part of the original content — they are reviewer feedback.",
                );
                L.push("");
                L.push(
                    '- `<!-- markonator:thread id="t1" line="5" anchor="a1" snippet="..." ts="..." -->` opens a thread. `line` = 1-indexed file line; `anchor` = id of an inline anchor wrapping the selected text; `snippet` = the referenced text (use it if line numbers have shifted).',
                );
                L.push(
                    '- Inside a thread, comments are: `<!-- markonator:c id="c1" replyTo="" ts="..." -->` body `<!-- /markonator:c -->`. `replyTo` is empty for the thread root, or a parent comment id for replies. Later replies may supersede earlier ones (agreements / corrections).',
                );
                L.push(
                    '- Threads close with `<!-- /markonator:thread -->`. Inline anchors wrap text: `<!-- markonator:anchor id="a1" -->text<!-- /markonator:anchor -->`.',
                );
                L.push("");

                L.push("## Instructions");
                if (savedInPlace) {
                    L.push("1. Open `" + planPath + "`.");
                    L.push(
                        "2. Locate the `markonator:` review blocks (around lines " +
                            spanStr +
                            ").",
                    );
                    L.push(
                        "3. For each thread, find the referenced text (via snippet / line / anchor) and revise that part to address the feedback, respecting the reply thread (a later reply may change what's wanted).",
                    );
                    L.push(
                        "4. After addressing a thread, remove all its `<!-- markonator:... -->` blocks and any `markonator:anchor` wrappers it introduced.",
                    );
                    L.push(
                        "5. Leave untouched any content that has no comments.",
                    );
                    L.push("6. Return the full revised plan file.");
                } else {
                    L.push(
                        "1. For each thread below, locate the referenced text (via snippet / line / anchor) in the document included at the bottom.",
                    );
                    L.push(
                        "2. Revise that part to address the feedback, respecting the reply thread (a later reply may change what's wanted).",
                    );
                    L.push(
                        "3. After addressing a thread, remove all its `<!-- markonator:... -->` blocks and any `markonator:anchor` wrappers.",
                    );
                    L.push(
                        "4. Leave untouched any content that has no comments.",
                    );
                    L.push("5. Return the full revised Markdown document.");
                }
                L.push("");

                L.push("## Review threads to address");
                if (unresolvedRanges.length === 0) {
                    if (resolvedCount > 0) {
                        L.push("(all threads are marked resolved — just remove their `markonator:` blocks)");
                    } else {
                        L.push("(none — this file has no review comments yet)");
                    }
                } else {
                    unresolvedRanges.forEach((r, idx) => {
                        const t = r.thread;
                        let loc = "line " + (t.line || "?");
                        if (t.snippet) loc += ', snippet "' + t.snippet + '"';
                        if (t.anchor) loc += " (anchor " + t.anchor + ")";
                        L.push(idx + 1 + ". " + loc);
                        const byId = {};
                        t.comments.forEach((c) => (byId[c.id] = c));
                        const roots = t.comments.filter(
                            (c) => !c.replyTo || !byId[c.replyTo],
                        );
                        function emit(c, depth) {
                            const prefix =
                                depth === 0
                                    ? "   • "
                                    : "     ".repeat(depth) + "↳ ";
                            L.push(prefix + (c.body || "(empty)"));
                            t.comments
                                .filter((x) => x.replyTo === c.id)
                                .forEach((k) => emit(k, depth + 1));
                        }
                        roots.forEach((rt) => emit(rt, 0));
                    });
                }
                if (resolvedCount > 0 && unresolvedRanges.length > 0) {
                    L.push("(Additionally, " + resolvedCount + " thread(s) are already marked resolved — remove their `markonator:` blocks as well.)");
                }
                L.push("");

                if (savedInPlace) {
                    L.push("Plan file: " + planPath);
                } else {
                    L.push("## Full document with comments");
                    L.push("```markdown");
                    L.push(serializeDoc(state.doc));
                    L.push("```");
                    L.push("");
                    L.push("Source file (not yet updated): " + planPath);
                }
                return L.join("\n");
            }
            async function copyAgentPrompt() {
                const text = buildAgentPrompt();
                const savedInPlace = !!state.fileHandle && !state.dirty;
                const okMsg = savedInPlace
                    ? "Saved-mode prompt copied (file referenced; no full content) ✓"
                    : "Prompt copied with full content (not yet saved) ✓";
                let ok = false;
                try {
                    await navigator.clipboard.writeText(text);
                    ok = true;
                } catch (e) {
                    // fallback for non-secure contexts (file://)
                    const ta = document.createElement("textarea");
                    ta.value = text;
                    ta.style.position = "fixed";
                    ta.style.opacity = "0";
                    document.body.appendChild(ta);
                    ta.select();
                    try {
                        ok = document.execCommand("copy");
                    } catch (e2) {}
                    ta.remove();
                }
                toast(ok ? okMsg : "Copy failed — select & copy manually");
            }
            agentPromptBtn.addEventListener("click", copyAgentPrompt);

            /* ---------- UI: show doc / empty ---------- */
            function showDoc() {
                document.getElementById("emptyState").hidden = true;
                document.getElementById("doc").hidden = false;
                renderDoc();
                document.getElementById("saveBtn").disabled = false;
                document.getElementById("agentPromptBtn").disabled = false;
                document.getElementById("saveCopyBtn").disabled = false;
                updateFileTag();
                if (!hasMarkdown()) {
                    const b = document.getElementById("bannerWarn");
                    b.hidden = false;
                    b.textContent =
                        "⚠ Markdown renderer unavailable (offline). Showing raw text. Reload online to render.";
                } else {
                    document.getElementById("bannerWarn").hidden = true;
                }
            }
            function updateFileTag() {
                const tag = document.getElementById("fileTag");
                tag.hidden = false;
                const display = state.planPath || state.fileName;
                const nameEl = document.getElementById("fileName");
                nameEl.textContent = display;
                nameEl.title = display;
                tag.classList.toggle("dirty", state.dirty);
            }

            /* ---------- Editable plan path ---------- */
            (function setupPathEdit() {
                const tag = document.getElementById("fileTag");
                const input = document.getElementById("pathInput");
                function beginEdit() {
                    tag.classList.add("editing");
                    input.hidden = false;
                    input.value = state.planPath || state.fileName;
                    input.focus();
                    input.select();
                }
                function commit() {
                    const v = input.value.trim();
                    if (v) state.planPath = v;
                    tag.classList.remove("editing");
                    input.hidden = true;
                    updateFileTag();
                    try {
                        localStorage.setItem("markonator-planPath", state.planPath);
                    } catch (e) {}
                }
                tag.addEventListener("click", (e) => {
                    if (e.target === input) return;
                    if (tag.classList.contains("editing")) return;
                    beginEdit();
                });
                input.addEventListener("keydown", (e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        commit();
                    }
                    if (e.key === "Escape") {
                        tag.classList.remove("editing");
                        input.hidden = true;
                        updateFileTag();
                    }
                });
                input.addEventListener("blur", commit);
            })();

            /* ---------- Composer ---------- */
            const composerEl = document.getElementById("composer");
            const composerBackdrop =
                document.getElementById("composerBackdrop");
            const cText = document.getElementById("cText");
            const cPreview = document.getElementById("cPreview");

            function openComposer(ctx) {
                state.composer = ctx;
                const badge = document.getElementById("cBadge");
                const target = document.getElementById("cTarget");
                badge.classList.remove("anchor");
                if (ctx.type === "line") {
                    badge.textContent =
                        ctx.startLine === ctx.endLine
                            ? `Line ${ctx.startLine}`
                            : `Lines ${ctx.startLine}–${ctx.endLine}`;
                    target.textContent = "";
                } else if (ctx.type === "selection") {
                    badge.textContent = "Selection";
                    badge.classList.add("anchor");
                    target.textContent =
                        ctx.snippet.length > 50
                            ? ctx.snippet.slice(0, 50) + "…"
                            : ctx.snippet;
                } else if (ctx.type === "reply") {
                    badge.textContent = "Reply";
                    const t = state.doc.find(
                        (i) =>
                            i.kind === "thread" && i.thread.id === ctx.threadId,
                    );
                    target.textContent = t ? `in thread ${t.thread.id}` : "";
                } else if (ctx.type === "edit") {
                    badge.textContent = "Edit";
                    target.textContent = ctx.commentId
                        ? `#${ctx.commentId}`
                        : "";
                }
                cText.value = ctx.initial || "";
                updatePreview();
                composerEl.classList.add("open");
                composerBackdrop.classList.add("open");
                document.getElementById("cLeave").hidden = true;
                document.getElementById("cSubmit").textContent =
                    ctx.type === "reply"
                        ? "Post reply"
                        : ctx.type === "edit"
                          ? "Save edit"
                          : "Add comment";
                setTimeout(() => cText.focus(), 50);
            }
            function closeComposer(opts = {}) {
                const hasText = cText.value.trim().length > 0;
                if (hasText && !opts.force) {
                    document.getElementById("cLeave").hidden = false;
                    return;
                }
                composerEl.classList.remove("open");
                composerBackdrop.classList.remove("open");
                state.composer = null;
            }
            function updatePreview() {
                const v = cText.value;
                if (!v.trim()) {
                    cPreview.innerHTML =
                        '<span class="ph">Preview appears here…</span>';
                    return;
                }
                cPreview.innerHTML = renderMd(v);
            }
            cText.addEventListener("input", updatePreview);
            cText.addEventListener("keydown", (e) => {
                if (e.key === "Escape") {
                    e.preventDefault();
                    closeComposer();
                }
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    submitComposer();
                }
            });

            function submitComposer() {
                const body = cText.value.trim();
                if (!body) {
                    closeComposer({ force: true });
                    return;
                }
                const ctx = state.composer;
                if (!ctx) return;
                const ts = new Date().toISOString();
                if (ctx.type === "line" || ctx.type === "selection") {
                    let anchorId = "";
                    if (
                        ctx.type === "selection" &&
                        ctx.lineItem &&
                        ctx.positions
                    ) {
                        anchorId = "a" + state.nextAnchorId++;
                        const li = ctx.lineItem;
                        const p = ctx.positions;
                        const before = li.text.slice(0, p.start);
                        const inner = li.text.slice(p.start, p.end);
                        const after = li.text.slice(p.end);
                        li.text =
                            before +
                            '<!-- markonator:anchor id="' +
                            anchorId +
                            '" -->' +
                            inner +
                            "<!-- /markonator:anchor -->" +
                            after;
                    }
                    const tid = "t" + state.nextThreadId++;
                    const cid = "c" + state.nextCommentId++;
                    const line =
                        ctx.startLine === ctx.endLine
                            ? String(ctx.startLine)
                            : `${ctx.startLine}-${ctx.endLine}`;
                    const thread = {
                        id: tid,
                        line,
                        anchor: anchorId || "",
                        snippet: ctx.snippet || "",
                        ts,
                        comments: [{ id: cid, replyTo: "", ts, body }],
                    };
                    // insert after the line block
                    const idx = findItemIndexAfterLine(ctx.endLine);
                    state.doc.splice(idx + 1, 0, {
                        kind: "thread",
                        startLine: -1,
                        endLine: -1,
                        thread,
                    });
                    state.dirty = true;
                } else if (ctx.type === "reply") {
                    const item = state.doc.find(
                        (i) =>
                            i.kind === "thread" && i.thread.id === ctx.threadId,
                    );
                    if (item) {
                        const cid = "c" + state.nextCommentId++;
                        item.thread.comments.push({
                            id: cid,
                            replyTo: ctx.replyTo || "",
                            ts,
                            body,
                        });
                        state.dirty = true;
                    }
                } else if (ctx.type === "edit") {
                    const item = state.doc.find(
                        (i) =>
                            i.kind === "thread" && i.thread.id === ctx.threadId,
                    );
                    if (item) {
                        const c = item.thread.comments.find(
                            (x) => x.id === ctx.commentId,
                        );
                        if (c) {
                            c.body = body;
                            // bump ts to reflect the edit
                            c.ts = ts;
                            state.dirty = true;
                        }
                    }
                }
                closeComposer({ force: true });
                renderDoc();
                updateFileTag();
                persistState();
                maybeAutoSave();
            }

            function findItemIndexAfterLine(lineNo) {
                // find the line item with lineNo, return its index
                for (let i = 0; i < state.doc.length; i++) {
                    if (
                        state.doc[i].kind === "line" &&
                        state.doc[i].lineNo === lineNo
                    )
                        return i;
                }
                // fallback: find last line item <= lineNo
                let best = -1;
                for (let i = 0; i < state.doc.length; i++)
                    if (
                        state.doc[i].kind === "line" &&
                        state.doc[i].lineNo <= lineNo
                    )
                        best = i;
                return best;
            }

            /* ---------- Selection commenting ---------- */
            const selHint = document.getElementById("selHint");
            let selHideTimer = null;
            document.addEventListener("selectionchange", () => {
                if (composerEl.classList.contains("open")) return;
                const sel = window.getSelection();
                if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
                    selHint.style.display = "none";
                    return;
                }
                const range = sel.getRangeAt(0);
                const blockEl =
                    range.startContainer.parentElement?.closest(".block");
                if (
                    !blockEl ||
                    !document.getElementById("doc").contains(blockEl)
                ) {
                    selHint.style.display = "none";
                    return;
                }
                const text = sel.toString();
                if (!text.trim()) {
                    selHint.style.display = "none";
                    return;
                }
                const rect = range.getBoundingClientRect();
                if (rect.width === 0 && rect.height === 0) {
                    selHint.style.display = "none";
                    return;
                }
                selHint.style.display = "block";
                selHint.style.left = rect.left + rect.width / 2 - 70 + "px";
                selHint.style.top = rect.top - 32 + window.scrollY + "px";
            });
            selHint.addEventListener("mousedown", (e) => {
                e.preventDefault();
                handleSelectionComment();
            });
            selHint.addEventListener("click", handleSelectionComment);

            /* ---------- Floating cursor-following add-comment button ---------- */
            const floatingAdd = document.getElementById("floatingAdd");
            let activeBlock = null;
            function hideFloatingAdd() {
                floatingAdd.classList.remove("show");
                floatingAdd.style.display = "none";
                activeBlock = null;
            }
            document.addEventListener("mousemove", (e) => {
                if (composerEl.classList.contains("open")) {
                    hideFloatingAdd();
                    return;
                }
                const el = document.elementFromPoint(e.clientX, e.clientY);
                // If the cursor is over the add button itself, keep it shown so the
                // user (or test driver) can click it without it vanishing.
                if (el && (el === floatingAdd || floatingAdd.contains(el))) return;
                const block = el ? el.closest(".block") : null;
                const docEl = document.getElementById("doc");
                if (!block || !docEl.contains(block)) {
                    hideFloatingAdd();
                    return;
                }
                const blockRect = block.getBoundingClientRect();
                // only show when the cursor is within the block's vertical span
                if (e.clientY < blockRect.top || e.clientY > blockRect.bottom) {
                    hideFloatingAdd();
                    return;
                }
                activeBlock = block;
                floatingAdd.style.display = "flex";
                // align with cursor Y, clamped inside the block, and sit in the gutter
                const y = Math.max(
                    blockRect.top + 13,
                    Math.min(e.clientY, blockRect.bottom - 13),
                );
                floatingAdd.style.top = y - 13 + "px";
                floatingAdd.style.left = blockRect.left - 34 + "px";
                requestAnimationFrame(() => floatingAdd.classList.add("show"));
            });
            floatingAdd.addEventListener("click", () => {
                if (!activeBlock) return;
                const startLine = parseInt(activeBlock.dataset.lineStart);
                const endLine = parseInt(activeBlock.dataset.lineEnd);
                hideFloatingAdd();
                openComposer({
                    type: "line",
                    startLine,
                    endLine,
                    blockEl: activeBlock,
                });
            });
            document.addEventListener("mouseleave", hideFloatingAdd);
            window.addEventListener("blur", hideFloatingAdd);

            function handleSelectionComment() {
                const sel = window.getSelection();
                if (!sel || sel.isCollapsed) return;
                const range = sel.getRangeAt(0);
                const blockEl =
                    range.startContainer.parentElement?.closest(".block");
                if (!blockEl) return;
                const startLine = parseInt(blockEl.dataset.lineStart);
                const endLine = parseInt(blockEl.dataset.lineEnd);
                const snippet = sel.toString().trim().replace(/\s+/g, " ");
                // Decide line vs anchor
                // Try to find the selected text within the source lines of this block.
                const blockItems = state.doc.filter(
                    (it) =>
                        it.kind === "line" &&
                        it.lineNo >= startLine &&
                        it.lineNo <= endLine,
                );
                const joinedSrc = blockItems.map((it) => it.text).join("\n");
                const normSel = snippet;
                const normSrc = joinedSrc.replace(/\s+/g, " ");
                const idx = normSrc.indexOf(normSel);
                if (idx >= 0 && blockItems.length === 1 && normSel.length > 2) {
                    // anchor opportunity: defer the actual line mutation to submit
                    // time so cancelling the composer leaves no orphan anchor.
                    const line = blockItems[0];
                    const positions = flexFind(line.text, normSel);
                    if (positions) {
                        const inner = line.text.slice(
                            positions.start,
                            positions.end,
                        );
                        openComposer({
                            type: "selection",
                            lineItem: line,
                            positions,
                            snippet: inner,
                            startLine: line.lineNo,
                            endLine: line.lineNo,
                        });
                        sel.collapseToEnd();
                        return;
                    }
                }
                // fallback: line-range comment with snippet
                openComposer({ type: "line", startLine, endLine, snippet });
                sel.collapseToEnd();
            }

            function flexFind(text, target) {
                // whitespace-flexible search; returns {start,end} in raw text or null
                const t = target.replace(/\s+/g, " ");
                const norm = text.replace(/\s+/g, " ");
                const idx = norm.indexOf(t);
                if (idx < 0) return null;
                // map normalized idx back to raw indices
                let rawStart = -1,
                    rawEnd = -1;
                let ni = 0;
                for (let ri = 0; ri < text.length; ri++) {
                    const ch = text[ri];
                    const isWS = /\s/.test(ch);
                    if (ni === idx) rawStart = ri;
                    if (!isWS || (ri > 0 && !/\s/.test(text[ri - 1]))) {
                        // advance ni for collapsed whitespace
                    }
                    // advance ni: collapse runs of whitespace
                    if (isWS) {
                        if (ri > 0 && /\s/.test(text[ri - 1])) {
                            /* continue run, don't advance */
                        } else ni++; // start of a whitespace run counts as one
                    } else ni++;
                    if (ni === idx + t.length) {
                        rawEnd = ri + 1;
                        break;
                    }
                }
                if (rawStart < 0) return null;
                // trim leading/trailing whitespace from raw span
                while (rawStart < rawEnd && /\s/.test(text[rawStart]))
                    rawStart++;
                while (rawEnd > rawStart && /\s/.test(text[rawEnd - 1]))
                    rawEnd--;
                return { start: rawStart, end: rawEnd };
            }

            /* ---------- Delete thread / comment ---------- */
            function toggleResolve(tid) {
                const item = state.doc.find((i) => i.kind === "thread" && i.thread.id === tid);
                if (item) {
                    item.thread.resolved = !item.thread.resolved;
                    state.dirty = true;
                    renderDoc();
                    updateFileTag();
                    persistState();
                    maybeAutoSave();
                }
            }
            function confirmDeleteThread(tid) {
                showModal(
                    "Delete thread?",
                    "This removes the thread and all its replies from the document.",
                    [
                        ["Cancel", ""],
                        ["Delete", "danger"],
                    ],
                    (which) => {
                        if (which === "Delete") {
                            state.doc = state.doc.filter(
                                (i) =>
                                    !(
                                        i.kind === "thread" &&
                                        i.thread.id === tid
                                    ),
                            );
                            // also remove anchors referenced only by this thread (best-effort: remove anchor tags whose thread is gone)
                            state.dirty = true;
                            renderDoc();
                            updateFileTag();
                            persistState();
                            maybeAutoSave();
                        }
                    },
                );
            }
            function confirmDeleteComment(tid, cid) {
                showModal(
                    "Delete comment?",
                    "This removes the comment. Replies to it will remain but become top-level.",
                    [
                        ["Cancel", ""],
                        ["Delete", "danger"],
                    ],
                    (which) => {
                        if (which === "Delete") {
                            const item = state.doc.find(
                                (i) =>
                                    i.kind === "thread" && i.thread.id === tid,
                            );
                            if (item) {
                                item.thread.comments = item.thread.comments
                                    .filter((c) => c.id !== cid)
                                    .map((c) =>
                                        c.replyTo === cid
                                            ? { ...c, replyTo: "" }
                                            : c,
                                    );
                                if (item.thread.comments.length === 0) {
                                    state.doc = state.doc.filter(
                                        (i) => i !== item,
                                    );
                                }
                                state.dirty = true;
                                renderDoc();
                                updateFileTag();
                                persistState();
                                maybeAutoSave();
                            }
                        }
                    },
                );
            }

            /* ---------- Modal ---------- */
            const modalBackdrop = document.getElementById("modalBackdrop");
            function showModal(title, body, buttons, cb) {
                document.getElementById("modalTitle").textContent = title;
                document.getElementById("modalBody").textContent = body;
                const acts = document.getElementById("modalActions");
                acts.innerHTML = "";
                buttons.forEach(([label, kind]) => {
                    const b = document.createElement("button");
                    b.textContent = label;
                    if (kind) b.className = kind;
                    b.onclick = () => {
                        modalBackdrop.classList.remove("open");
                        cb(label);
                    };
                    acts.appendChild(b);
                });
                modalBackdrop.classList.add("open");
            }

            /* ---------- Reset ---------- */
            async function resetAll() {
                showModal(
                    "Clear all browser state?",
                    "This removes the loaded document and all comments from this browser. The original file on disk is not touched.",
                    [
                        ["Cancel", ""],
                        ["Clear", "danger"],
                    ],
                    async (which) => {
                        if (which !== "Clear") return;
                        await idbClear();
                        state.doc = [];
                        state.fileName = "untitled.md";
                        state.fileHandle = null;
                        state.dirty = false;
                        recomputeIds();
                        document.getElementById("emptyState").hidden = false;
                        document.getElementById("doc").hidden = true;
                        document.getElementById("saveBtn").disabled = true;
                        document.getElementById("agentPromptBtn").disabled =
                            true;
                        document.getElementById("saveCopyBtn").disabled = true;
                        document.getElementById("fileTag").hidden = true;
                        toast("Browser state cleared");
                    },
                );
            }

            /* ---------- Auto-save ---------- */
            let autoSaveTimer = null;
            function maybeAutoSave() {
                if (!state.autoSave) return;
                if (!state.dirty || state.doc.length === 0) return;
                clearTimeout(autoSaveTimer);
                autoSaveTimer = setTimeout(() => saveFile(true), 800);
            }
            const autoSaveBtn = document.getElementById("autoSaveBtn");
            function setAutoSave(on) {
                state.autoSave = !!on;
                autoSaveBtn.setAttribute("aria-pressed", String(state.autoSave));
                autoSaveBtn.title = "Auto-save: " + (state.autoSave ? "on" : "off");
                try { localStorage.setItem("markonator-autoSave", state.autoSave ? "1" : "0"); } catch (e) {}
            }
            autoSaveBtn.addEventListener("click", () => {
                setAutoSave(!state.autoSave);
                if (state.autoSave) maybeAutoSave();
            });
            try { setAutoSave(localStorage.getItem("markonator-autoSave") === "1"); } catch (e) { setAutoSave(false); }

            /* ---------- Toast ---------- */
            function toast(msg) {
                const wrap = document.getElementById("toastWrap");
                const t = document.createElement("div");
                t.className = "toast";
                t.textContent = msg;
                wrap.appendChild(t);
                setTimeout(() => {
                    t.style.opacity = "0";
                    t.style.transition = "opacity .3s";
                    setTimeout(() => t.remove(), 300);
                }, 1800);
            }

            /* ---------- beforeunload ---------- */
            window.addEventListener("beforeunload", (e) => {
                if (state.dirty) {
                    e.preventDefault();
                    e.returnValue = "";
                    return "";
                }
                if (
                    composerEl.classList.contains("open") &&
                    cText.value.trim()
                ) {
                    e.preventDefault();
                    e.returnValue = "";
                    return "";
                }
            });

            /* ---------- Wire up UI ---------- */
            document.getElementById("openBtn").onclick = openFile;
            document.getElementById("openBtn2").onclick = openFile;
            document.getElementById("saveBtn").onclick = () => saveFile(false);
            document.getElementById("downloadBtn").onclick = () =>
                downloadFile(false);
            document.getElementById("resetBtn").onclick = resetAll;
            document.getElementById("cCancel").onclick = () => closeComposer();
            document.getElementById("cClose").onclick = () => closeComposer();
            document.getElementById("cSubmit").onclick = submitComposer;
            document.getElementById("cLeave").onclick = () =>
                closeComposer({ force: true });
            document.getElementById("composerBackdrop").onclick = () =>
                closeComposer();
            document.getElementById("saveCopyBtn").onclick = async () => {
                const ok2 = await saveFile(true);
                if (ok2) copyAgentPrompt();
            };

            /* ---------- Font picker ---------- */
            const FONTS = [
                { id: "system", label: "System Sans", stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif' },
                { id: "serif", label: "Serif", stack: 'Georgia, "Iowan Old Style", Charter, serif' },
                { id: "mono", label: "Mono", stack: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' },
                { id: "rounded", label: "Rounded", stack: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif' },
                { id: "inter", label: "Inter", stack: '"Inter", system-ui, sans-serif' },
                { id: "lora", label: "Lora", stack: '"Lora", Georgia, serif' },
                { id: "jetbrains", label: "JetBrains Mono", stack: '"JetBrains Mono", ui-monospace, monospace' },
                { id: "atkinson", label: "Atkinson Hyperlegible", stack: '"Atkinson Hyperlegible", system-ui, sans-serif' },
            ];
            const fontBtn = document.getElementById("fontBtn");
            const fontPopover = document.getElementById("fontPopover");
            function buildFontPopover() {
                fontPopover.innerHTML = "";
                FONTS.forEach((f) => {
                    const b = document.createElement("button");
                    b.className = "font-opt";
                    b.dataset.fontId = f.id;
                    b.style.fontFamily = f.stack;
                    const g = document.createElement("span");
                    g.className = "glyph";
                    g.textContent = "Aa";
                    const nm = document.createElement("span");
                    nm.className = "fname";
                    nm.textContent = f.label;
                    const chk = document.createElement("span");
                    chk.className = "check";
                    chk.textContent = "✓";
                    b.appendChild(g);
                    b.appendChild(nm);
                    b.appendChild(chk);
                    b.addEventListener("click", () => {
                        applyFont(f.id);
                        fontPopover.classList.remove("open");
                    });
                    fontPopover.appendChild(b);
                });
            }
            function applyFont(id) {
                const f = FONTS.find((x) => x.id === id) || FONTS[0];
                document.documentElement.style.setProperty("--doc-font", f.stack);
                try { localStorage.setItem("markonator-font", id); } catch (e) {}
                fontBtn.style.fontFamily = f.stack;
                fontPopover.querySelectorAll(".font-opt").forEach((o) =>
                    o.classList.toggle("active", o.dataset.fontId === id));
            }
            fontBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                fontPopover.classList.toggle("open");
            });
            document.addEventListener("click", (e) => {
                if (!fontPopover.contains(e.target) && e.target !== fontBtn)
                    fontPopover.classList.remove("open");
            });
            document.addEventListener("keydown", (e) => {
                if (e.key === "Escape") fontPopover.classList.remove("open");
            });
            buildFontPopover();
            (function initFont() {
                let id = "system";
                try { id = localStorage.getItem("markonator-font") || "system"; } catch (e) {}
                applyFont(id);
            })();
            document.querySelectorAll(".mobile-tabs button").forEach((b) => {
                b.onclick = () => {
                    document
                        .querySelectorAll(".mobile-tabs button")
                        .forEach((x) => x.classList.remove("active"));
                    b.classList.add("active");
                    const body = document.getElementById("composerBody");
                    if (b.dataset.tab === "preview")
                        body.classList.add("show-preview");
                    else body.classList.remove("show-preview");
                };
            });

            /* paste area */
            document.getElementById("loadPasteBtn").onclick = () => {
                const v = document.getElementById("pasteArea").value;
                if (!v.trim()) {
                    toast("Paste some markdown first");
                    return;
                }
                loadText(v, "pasted.md");
                toast("Loaded pasted content");
            };

            /* drag and drop */
            const dropzone = document.getElementById("dropzone");
            ["dragenter", "dragover"].forEach((ev) =>
                dropzone.addEventListener(ev, (e) => {
                    e.preventDefault();
                    dropzone.classList.add("drag");
                }),
            );
            ["dragleave", "drop"].forEach((ev) =>
                dropzone.addEventListener(ev, (e) => {
                    e.preventDefault();
                    dropzone.classList.remove("drag");
                }),
            );
            dropzone.addEventListener("drop", async (e) => {
                const f = e.dataTransfer.files[0];
                if (!f) return;
                loadText(await f.text(), f.name);
                toast(`Loaded ${f.name}`);
            });
            // also allow drop on main when doc is open
            document
                .getElementById("main")
                .addEventListener("dragover", (e) => e.preventDefault());
            document
                .getElementById("main")
                .addEventListener("drop", async (e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files[0];
                    if (!f) return;
                    loadText(await f.text(), f.name);
                });

            /* ---------- Theme picker ---------- */
            const THEMES = [
                { id: "auto", label: "Auto", split: true },
                {
                    id: "light",
                    label: "Light",
                    bg: "#ffffff",
                    accent: "#0969da",
                    text: "#1f2328",
                    border: "#d0d7de",
                },
                {
                    id: "dark",
                    label: "Dark",
                    bg: "#0d1117",
                    accent: "#58a6ff",
                    text: "#e6edf3",
                    border: "#30363d",
                },
                {
                    id: "nord",
                    label: "Nord",
                    bg: "#2e3440",
                    accent: "#88c0d0",
                    text: "#eceff4",
                    border: "#434c5e",
                },
                {
                    id: "solarized-dark",
                    label: "Solarized Dark",
                    bg: "#002b36",
                    accent: "#268bd2",
                    text: "#eee8d5",
                    border: "#0d4350",
                },
                {
                    id: "dracula",
                    label: "Dracula",
                    bg: "#282a36",
                    accent: "#bd93f9",
                    text: "#f8f8f2",
                    border: "#44475a",
                },
            ];
            const themeBtn = document.getElementById("themeBtn");
            const themePopover = document.getElementById("themePopover");
            const themeSwatch = document.getElementById("themeSwatch");

            function buildThemePopover() {
                themePopover.innerHTML = "";
                THEMES.forEach((t) => {
                    const btn = document.createElement("button");
                    btn.className = "theme-opt";
                    btn.dataset.themeId = t.id;
                    const mini = document.createElement("span");
                    mini.className = "mini" + (t.split ? " split" : "");
                    if (!t.split) {
                        mini.style.background = t.bg;
                        mini.style.borderColor = t.border;
                        const a = document.createElement("span");
                        a.className = "mini-accent";
                        a.style.background = t.accent;
                        const ln = document.createElement("span");
                        ln.className = "mini-line";
                        ln.style.background = t.text;
                        mini.appendChild(a);
                        mini.appendChild(ln);
                    }
                    const lab = document.createElement("span");
                    lab.className = "theme-opt-label";
                    lab.textContent = t.label;
                    const chk = document.createElement("span");
                    chk.className = "check";
                    chk.textContent = "✓";
                    btn.appendChild(mini);
                    btn.appendChild(lab);
                    btn.appendChild(chk);
                    btn.addEventListener("click", () => {
                        applyTheme(t.id);
                        closeThemePopover();
                    });
                    themePopover.appendChild(btn);
                });
            }
            function applyTheme(id) {
                if (id === "auto") {
                    document.documentElement.removeAttribute("data-theme");
                } else {
                    document.documentElement.setAttribute("data-theme", id);
                }
                try {
                    localStorage.setItem("markonator-theme", id);
                } catch (e) {}
                themeSwatch.className =
                    "theme-swatch" + (id === "auto" ? " auto" : "");
                themePopover.querySelectorAll(".theme-opt").forEach((o) => {
                    o.classList.toggle("active", o.dataset.themeId === id);
                });
                const meta = document.querySelector('meta[name="theme-color"]');
                if (meta) {
                    const dark =
                        id === "dark" ||
                        id === "nord" ||
                        id === "solarized-dark" ||
                        id === "dracula";
                    meta.content = dark ? "#0d1117" : "#ffffff";
                }
            }
            function closeThemePopover() {
                themePopover.classList.remove("open");
            }
            themeBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                themePopover.classList.toggle("open");
            });
            document.addEventListener("click", (e) => {
                if (
                    !themePopover.contains(e.target) &&
                    e.target !== themeBtn &&
                    !themeBtn.contains(e.target)
                ) {
                    closeThemePopover();
                }
            });
            document.addEventListener("keydown", (e) => {
                if (e.key === "Escape") closeThemePopover();
            });
            (function initTheme() {
                let saved = "auto";
                try {
                    saved = localStorage.getItem("markonator-theme") || "auto";
                } catch (e) {}
                buildThemePopover();
                applyTheme(saved);
            })();

            /* ---------- PWA: service worker + install prompt ---------- */
            const installBtn = document.getElementById("installBtn");
            if (isExtension) {
                installBtn.hidden = true;
            }
            let deferredInstall = null;
            window.addEventListener("beforeinstallprompt", (e) => {
                e.preventDefault();
                deferredInstall = e;
                installBtn.hidden = false;
            });
            installBtn.addEventListener("click", async () => {
                if (!deferredInstall) return;
                deferredInstall.prompt();
                const { outcome } = await deferredInstall.userChoice;
                if (outcome === "accepted") toast("Installed ✓");
                deferredInstall = null;
                installBtn.hidden = true;
            });
            window.addEventListener("appinstalled", () => {
                installBtn.hidden = true;
                deferredInstall = null;
            });

            if (!isExtension && !isTest && "serviceWorker" in navigator) {
                window.addEventListener("load", () => {
                    navigator.serviceWorker
                        .register("./service-worker.js")
                        .then((reg) => {
                            // pick up updates in the background
                            reg.addEventListener("updatefound", () => {
                                const nw = reg.installing;
                                if (!nw) return;
                                nw.addEventListener("statechange", () => {
                                    if (
                                        nw.state === "installed" &&
                                        navigator.serviceWorker.controller
                                    ) {
                                        toast("Update ready — reload to apply");
                                    }
                                });
                            });
                        })
                        .catch((err) => {
                            // SW registration only works in a secure context
                            // (http/localhost). Silently ignore on file://.
                            console.warn(
                                "SW registration skipped:",
                                err.message,
                            );
                        });
                });
            }

            /* ---------- Boot ---------- */
            (async function init() {
                if (supportsFSA()) {
                    // good
                } else {
                    const b = document.getElementById("bannerWarn");
                    // will show only after a doc loads
                }
                const loaded = await loadPersisted();
                if (!loaded) {
                    // stay on empty state
                }
            })();
        

/* ---------- Test hook (only active when the page is loaded with ?test=1) ----------
   Exposes internals for the automated test suite. Has no effect in normal use
   and exposes nothing unless the query string explicitly opts in. */
if (
    typeof window !== "undefined" &&
    new URLSearchParams(location.search).get("test") === "1"
) {
    try {
        window.__markonator = {
            state: state,
            parseMarkdown: parseMarkdown,
            serializeDoc: serializeDoc,
            fileLineRanges: fileLineRanges,
            buildAgentPrompt: buildAgentPrompt,
            flexFind: flexFind,
            loadText: loadText,
            renderDoc: renderDoc,
        };
    } catch (e) {
        window.__markonator_err = String((e && (e.stack || e.message)) || e);
    }
}
