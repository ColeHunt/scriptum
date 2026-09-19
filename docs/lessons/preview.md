---
sidebar_position: 4
title: Reading Documents (Preview)
---

# Reading Documents (Preview)

Preview opens project Markdown and HTML reports beside the editor. Click the
**Preview** tab, then choose a document from the toolbar. A root `README.md`
opens automatically.

The picker searches the full project path. For example, `reports test index`
finds `build/reports/tests/test/index.html` and helps distinguish the many
`index.html` files in a generated report.

## Refreshing a document

Preview does not watch the project. Click **Refresh** after editing a document
or generating a report. This rescans the project and reloads the current page
and its local assets. If the file was removed, choose another one from the
updated list.

## Supported files

- `.md` files, including local images and heading links
- `.html` and `.htm` files, including local stylesheets, scripts, images, fonts,
  and linked report pages

Generated files under `build/reports/**` are included. Preview skips `.git`,
`.gradle`, and `node_modules` and will tell you if a large project exceeds its
listing limit.

Preview is read-only and does not load content from the internet. Reports that
depend on a CDN, browser storage, or a server connection may look incomplete.
Edit files in the editor and refresh when you are ready to view them.

For a plain Java lesson, use the **Preview** button in the top bar to show or
hide the document pane.
