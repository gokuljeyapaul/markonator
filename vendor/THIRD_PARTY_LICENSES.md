# Third-party licenses

Marginalia bundles the following third-party libraries in this `vendor/`
directory. Their license texts are included alongside the minified files and
are also reproduced below.

## marked — Markdown parser

- Version: 12.0.2
- License: **MIT**
- Copyright (c) 2018+, MarkedJS (https://github.com/markedjs/)
- Copyright (c) 2011-2018, Christopher Jeffrey (https://github.com/chjj/)
- Source: https://github.com/markedjs/marked
- License file: `marked.LICENSE.md`

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## DOMPurify — HTML sanitizer

- Version: 3.1.6
- License: **MPL-2.0 OR Apache-2.0** (dual-licensed)
- Copyright 2024 Dr.-Ing. Mario Heiderich, Cure53
- Source: https://github.com/cure53/DOMPurify
- License file: `purify.LICENSE` (contains the full text of both the Apache
  License 2.0 and the Mozilla Public License 2.0)

Marginalia distributes DOMPurify under the terms of the **Apache License 2.0**
(one of the two licenses offered by the project). The full Apache 2.0 license
text is included in `purify.LICENSE`. Full, unminified source is available at
the upstream repository above.

## Notice for distribution

When redistributing Marginalia or a build of it (including the Chrome
extension), retain these license files in the `vendor/` directory alongside the
minified libraries. No modifications have been made to either library beyond
minification as shipped by the upstream projects.