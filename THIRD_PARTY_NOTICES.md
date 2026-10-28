# Third-party notices

Vault Viewer's own code is released under the MIT License (see [LICENSE](LICENSE)).
The `vendor/` directory contains the following third-party components, which are
loaded on demand. Each keeps its own license.

| Component | Files | License | Full text |
|-----------|-------|---------|-----------|
| highlight.js 11.12.0 | `vendor/highlight.min.js` | BSD-3-Clause | [vendor/licenses/highlightjs-LICENSE.txt](vendor/licenses/highlightjs-LICENSE.txt) |
| KaTeX | `vendor/katex.min.js`, `vendor/katex.min.css`, `vendor/fonts/*.woff2` | MIT | [vendor/licenses/katex-LICENSE.txt](vendor/licenses/katex-LICENSE.txt) |
| Mermaid | `vendor/mermaid.min.js` | MIT | [vendor/licenses/mermaid-LICENSE.txt](vendor/licenses/mermaid-LICENSE.txt) |
| DOMPurify (bundled inside Mermaid) | `vendor/mermaid.min.js` | Apache-2.0 OR MPL-2.0 (dual-licensed) | [vendor/licenses/dompurify-LICENSE.txt](vendor/licenses/dompurify-LICENSE.txt) |

## Notes

- **Mermaid's bundled dependencies** (for example lodash, cytoscape and Promises/A+)
  are MIT-licensed. Their license comments are embedded inline in
  `vendor/mermaid.min.js`. Do not strip those comments when updating the file.
- **highlight.js** copyright notices appear in the file header. The BSD-3-Clause
  text requires that the copyright notice and conditions accompany redistribution.
- **DOMPurify** is dual-licensed, and either license may be chosen. The Apache-2.0 and
  MPL-2.0 texts are both in the upstream LICENSE file, which is included here.
- Vendored files are unmodified copies of the upstream distributions.
