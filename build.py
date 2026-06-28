#!/usr/bin/env python3
"""Assemble the Chrome extension from the shared sources.

The web app (repo root) is the canonical home of the app logic, styles, and
bundled assets:
  - src/app.js, src/styles.css               -> shared code
  - vendor/marked.min.js, vendor/purify.min.js -> bundled renderer libs
  - vendor/fonts/*.woff2 + fonts.css + OFL.txt -> bundled content fonts
  - icons/icon{16,32,48,128}.png              -> generated from icon.svg

This script copies only the runtime files into extension/, generates the
extension pages (extension/index.html full-tab + extension/sidepanel.html side
panel) from the web shell, and zips EXACTLY the files the Chrome Web Store
needs — no tests, no README, no source maps, no extra icon sizes, no stray
files. manifest.json sits at the root of the zip. The extension has zero
remote resources (fonts are bundled, not fetched).

Usage:
    python3 build.py            # assemble extension/ and extension/*.zip

Then either:
    - Load `extension/` unpacked: chrome://extensions -> Developer mode -> Load unpacked
    - Publish: upload extension/markonator-extension.zip to the Chrome Web Store
"""

import os
import re
import shutil
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
EXT = os.path.join(ROOT, "extension")

# Runtime vendor files. The license texts are included because redistribution
# requires it (MIT for marked; Apache-2.0 — one of DOMPurify's two licenses —
# requires retaining the license). THIRD_PARTY_LICENSES.md is a repo-level
# notice and is intentionally NOT shipped inside the extension package.
VENDOR_FILES = ["marked.min.js", "purify.min.js", "marked.LICENSE.md", "purify.LICENSE"]
ICON_SIZES = [16, 32, 48, 128]  # only the sizes the MV3 manifest references

# Runtime files that go into the Web Store zip. Font files (under vendor/fonts/)
# are added in main() by listing that directory at build time.
_BASE_ZIP = (
    [
        "manifest.json",
        "background.js",
        "index.html",
        "sidepanel.html",
        "app.js",
        "styles.css",
    ]
    + [f"icons/icon{s}.png" for s in ICON_SIZES]
    + [f"vendor/{f}" for f in VENDOR_FILES]
)


def copy_file(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)


def build_page():
    web = open(os.path.join(ROOT, "index.html")).read()
    page = web
    page = page.replace('href="src/styles.css"', 'href="styles.css"')
    page = page.replace('src="src/app.js"', 'src="app.js"')
    # drop PWA-only links (the extension has its own MV3 manifest; no apple-touch-icon)
    page = re.sub(r'\s*<link rel="manifest" href="\./manifest\.json" />', "", page)
    page = re.sub(r'\s*<link rel="apple-touch-icon"[^>]*/>', "", page)
    page = page.replace('href="./icon.svg"', 'href="icons/icon32.png"')
    # mark extension mode so app.js skips SW registration + install prompt
    page = page.replace(
        '<meta name="theme-color" content="#0d1117" />',
        '<meta name="theme-color" content="#0d1117" />\n'
        '        <meta name="markonator-mode" content="extension" />',
    )
    return page


def main():
    # 1) shared code
    copy_file(os.path.join(ROOT, "src", "app.js"), os.path.join(EXT, "app.js"))
    copy_file(os.path.join(ROOT, "src", "styles.css"), os.path.join(EXT, "styles.css"))
    # 2) runtime vendor libs + their license texts only
    for f in VENDOR_FILES:
        copy_file(os.path.join(ROOT, "vendor", f), os.path.join(EXT, "vendor", f))
    # 2b) bundled fonts (local woff2 + fonts.css + OFL license) so every font
    #     option works fully offline, with zero remote resources.
    fonts_src = os.path.join(ROOT, "vendor", "fonts")
    for f in os.listdir(fonts_src):
        copy_file(os.path.join(fonts_src, f), os.path.join(EXT, "vendor", "fonts", f))
    # 3) only the icon sizes referenced by the manifest
    for s in ICON_SIZES:
        copy_file(
            os.path.join(ROOT, "icons", f"icon{s}.png"),
            os.path.join(EXT, "icons", f"icon{s}.png"),
        )

    # 4) generate the extension pages
    page = build_page()
    open(os.path.join(EXT, "index.html"), "w").write(page)
    open(os.path.join(EXT, "sidepanel.html"), "w").write(page)

    # 5) zip EXACTLY the runtime file set (manifest.json at the zip root)
    zip_path = os.path.join(EXT, "markonator-extension.zip")
    if os.path.exists(zip_path):
        os.remove(zip_path)
    fonts = [
        f"vendor/fonts/{f}"
        for f in sorted(os.listdir(os.path.join(EXT, "vendor", "fonts")))
    ]
    zip_files = list(_BASE_ZIP) + fonts
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in zip_files:
            full = os.path.join(EXT, rel)
            if not os.path.exists(full):
                raise SystemExit(f"build: missing required file: {rel}")
            z.write(full, rel)

    print("Extension assembled in:", EXT)
    print("Zip:", zip_path)
    with zipfile.ZipFile(zip_path) as z:
        print("Contents (%d files):" % len(z.namelist()))
        for n in sorted(z.namelist()):
            print("   ", n)


if __name__ == "__main__":
    main()
