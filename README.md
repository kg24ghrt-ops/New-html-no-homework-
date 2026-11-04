# B5 Notebook Paper

A browser-based B5 (182x257mm) ruled notebook paper app. Draw on canvas,
type in a transparent overlay, pan and zoom with touch or mouse.

## Run

Open `index.html` in a modern browser. No build step required.

## Test

```
npm test
```

Uses Jest. Tests cover paper constants, `paperRect` aspect/fit/mobile behavior,
text alignment (canvas x equals textarea x, baseline sits above the rule),
and text inset vs margin line.

## Controls

- Drag: pan the paper
- Pinch / Ctrl+wheel: zoom
- Double tap / double click: toggle fit and 2.5x
- Tap: place caret at that line and column
- Button or `R`: reset view
- Ctrl+Z / Ctrl+Shift+Z: undo / redo
- Prev/Next buttons: navigate pages
- Template buttons: switch ruled / grid / dotted, toggle margin line and holes
- Export button: download current page as PNG