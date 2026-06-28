# Privacy Policy — Marginalia

**Last updated: 2026-06-28**

Marginalia is a local-first tool for reviewing Markdown files. This policy
applies to both the web app and the Chrome extension.

## Data we collect

**None.** Marginalia does not collect, transmit, or sell any personal data or
personally identifiable information. There is no server, no account, no
analytics, no telemetry, and no advertising.

## Data stored on your device

All state is stored **locally in your browser**, on your device only:

- The document you open and the comments you add — in **IndexedDB**.
- Your theme, font, auto-save, and plan-path preferences — in **localStorage**.
- If you use **Save**, comments are written to the file you choose on your own
  disk via the browser's File System Access API. If you use **Download**, a file
  is saved to your downloads folder. Both happen only when you explicitly
  choose them.

You can erase all browser state at any time with the **Reset** button.

## Network access

**None.** Marginalia makes no network requests at all. The Markdown renderer
(`marked`), the HTML sanitizer (`DOMPurify`), and all content fonts (Inter,
Lora, JetBrains Mono, Atkinson Hyperlegible) are bundled locally in
`vendor/` — so the app is fully offline. Nothing about your documents,
comments, or usage is ever transmitted anywhere.

## Permissions (Chrome extension)

The Chrome extension requests only the **`sidePanel`** permission, used to open
Marginalia in the browser side panel. No `host_permissions`, no `tabs`, no
`webRequest`, no content scripts that read page content. The extension does not
read or modify any website you visit.

## Third-party code

Marginalia bundles `marked` (MIT) and `DOMPurify` (Apache-2.0 OR MPL-2.0). See
`vendor/THIRD_PARTY_LICENSES.md`. These libraries run locally to render and
sanitize Markdown; they do not transmit data.

## Children's privacy

Marginalia is a developer tool and is not directed at children under 13. We do
not knowingly collect any data from anyone.

## Changes

If this policy changes, the updated version will be in this repository.

## Contact

Open an issue at https://github.com/gokuljeyapaul/marginalia (the repository may
be private; if you cannot access it, contact the author directly).