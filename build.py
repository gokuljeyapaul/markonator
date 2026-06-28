#!/usr/bin/env python3
"""Assemble the Chrome extension from the shared sources.

The web app (repo root) is the canonical home of the app logic and styles:
  - src/app.js, src/styles.css   -> shared code
  - vendor/marked.min.js, vendor/purify.min.js -> bundled renderer libs
  - icons/icon{16,32,48,128}.png -> generated from icon.svg

This script copies those into extension/ and generates extension/index.html
(the full-tab page) and extension/sidepanel.html (the side-panel page) from
the web shell, adjusting asset paths and marking extension mode so app.js
skips PWA-only features (service worker + install prompt).

Usage:
    python3 build.py            # assemble extension/ and extension/*.zip

Then either:
    - Load `extension/` unpacked: chrome://extensions -> Developer mode -> Load unpacked
    - Publish: upload extension/marginalia-extension.zip to the Chrome Web Store
"""

import os
import re
import shutil
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
EXT = os.path.join(ROOT, "extension")


def copy_file(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)


def main():
    # 1) shared code, vendor libs, and icons into extension/
    copy_file(os.path.join(ROOT, "src", "app.js"), os.path.join(EXT, "app.js"))
    copy_file(
        os.path.join(ROOT, "src", "styles.css"), os.path.join(EXT, "styles.css")
    )
    for f in os.listdir(os.path.join(ROOT, "vendor")):
        copy_file(
            os.path.join(ROOT, "vendor", f), os.path.join(EXT, "vendor", f)
        )
    for f in os.listdir(os.path.join(ROOT, "icons")):
        copy_file(os.path.join(ROOT, "icons", f), os.path.join(EXT, "icons", f))

    # 2) generate extension pages from the web shell
    web = open(os.path.join(ROOT, "index.html")).read()
    page = web
    page = page.replace('href="src/styles.css"', 'href="styles.css"')
    page = page.replace('src="src/app.js"', 'src="app.js"')
    # drop PWA-only links (extension has its own MV3 manifest; no apple touch icon)
    page = re.sub(r'\s*<link rel="manifest" href="\./manifest\.json" />', "", page)
    page = re.sub(r'\s*<link rel="apple-touch-icon"[^>]*/>', "", page)
    page = page.replace('href="./icon.svg"', 'href="icons/icon32.png"')
    # mark extension mode so app.js skips SW registration + install prompt
    page = page.replace(
        '<meta name="theme-color" content="#0d1117" />',
        '<meta name="theme-color" content="#0d1117" />\n'
        '        <meta name="marginalia-mode" content="extension" />',
    )
    open(os.path.join(EXT, "index.html"), "w").write(page)
    open(os.path.join(EXT, "sidepanel.html"), "w").write(page)

    # 3) zip the extension for the Chrome Web Store
    zip_path = os.path.join(EXT, "marginalia-extension.zip")
    if os.path.exists(zip_path):
        os.remove(zip_path)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for dp, _dn, fn in os.walk(EXT):
            for f in fn:
                if f.endswith(".zip"):
                    continue
                full = os.path.join(dp, f)
                arc = os.path.relpath(full, EXT)
                z.write(full, arc)

    print("Extension assembled in:", EXT)
    print("Zip:", zip_path)


if __name__ == "__main__":
    main()
