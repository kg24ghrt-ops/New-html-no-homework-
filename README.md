# B5 Notebook Paper

A browser-based B5 (182x257mm) ruled notebook paper app. Draw on canvas,
type in a transparent overlay, pan and zoom with touch or mouse.

## Run

Open `index.html` in a modern browser. If your browser blocks ES modules on
`file://`, serve the folder instead (`python3 -m http.server`). No build step
required.

## Fonts

Both font files are bundled locally in `fonts/` (no CDN, works offline):

- `Caveat-Regular.woff2` - Latin handwriting, SIL Open Font License 1.1
  (`fonts/OFL-Caveat.txt`)
- `NotoSansMyanmar-Regular.woff2` - Myanmar script, SIL Open Font License 1.1
  (`fonts/OFL-NotoSansMyanmar.txt`)

The Handwriting mode uses `Caveat` first and falls back to `Noto Sans Myanmar`
for Burmese. The Monospace mode is a safe fallback if a device shapes Myanmar
badly.

## Test

```
npm test
```

Uses Jest. Tests cover paper constants, text wrapping and page splitting,
`paperRect` aspect/fit/mobile behavior, text alignment (canvas x equals
textarea x, baseline sits above the rule), and text inset vs margin line.

## Controls

- Drag: pan the paper
- Pinch / Ctrl+wheel: zoom
- Double tap / double click: toggle fit and 2.5x
- Tap: place caret at that line and column
- Button or `R`: reset view
- Ctrl+Z / Ctrl+Shift+Z: undo / redo
- Prev/Next buttons: navigate pages
- Template buttons: switch ruled / grid / dotted, toggle margin line and holes
- `F`: switch Handwriting / Monospace (saved in settings)
- `S`: toggle faint show-through of the previous page (off by default)
- Export button: download the full current page as PNG
- Writing is saved automatically in this browser
