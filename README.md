# Vault Viewer

A read-only, fully client-side viewer for Obsidian vaults. Pick a vault folder in
your browser and browse notes, Bases and the link graph. Nothing is uploaded and
no files are changed.

## Features

- Browse the vault as a file tree, with filtering by name or `#tag`
- Render Markdown notes with Obsidian-flavoured syntax: frontmatter, wikilinks,
  backlinks, callouts and task lists
- Render `.base` files (Obsidian Bases) as tables, cards and kanban columns
- Interactive link graph view
- Math (KaTeX), code highlighting (highlight.js) and Mermaid diagrams
- Light and dark themes, and print / save-as-PDF

## Running it

No build step and no dependencies to install. Either:

- open `index.html` directly in a browser, or
- serve the folder with any static file server, for example
  `python -m http.server` from the project directory.

Click the folder icon and choose your vault. Chromium-based browsers use the native
folder picker. Other browsers fall back to a file input that accepts a folder.

## Project layout

| Path | Purpose |
|------|---------|
| `index.html` | Entry page and layout |
| `lib.js` | Pure logic: YAML subset, frontmatter, Markdown renderer, Bases expression engine. No DOM access. |
| `app.js` | UI: vault loading, navigation, rendering, graph view |
| `app.css`, `theme.css` | Layout styles, then colours and theme |
| `vendor/` | Third-party libraries loaded on demand (see below) |

## Licensing

Vault Viewer is released under the [MIT License](LICENSE).

The `vendor/` directory contains third-party libraries under their own licenses
(MIT, BSD-3-Clause, and Apache-2.0 / MPL-2.0 for DOMPurify). See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for details and full license texts.

"Obsidian" is a trademark of its owner. This project is an independent viewer and is
not affiliated with or endorsed by Obsidian.
