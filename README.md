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
textarea x, baseline sits above the rule), script-run splitting, whole Myanmar
runs, visual offset caps, stable per-glyph jitter and line padding.

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

## Manual phone checklist

The browser test suite cannot shape Myanmar or place a real caret, so check
these on a phone (or a mobile emulator) before shipping:

1. Open the app over `http://` or `https://` (or a browser that allows local
   module/font loading) and wait for the paper to appear.
2. In Handwriting mode, type a Burmese paragraph containing stacked
   consonants, for example:
   `မြန်မာစာ ကျွန်တော် ပြည်ထောင်စု`
   - No tofu boxes, no missing or clipped marks above/below the rule.
3. Type a mixed line: `Hello မြန်မာ world hello` and let it wrap.
   - The English letters keep their handwriting jitter.
   - The whole Burmese word is drawn in one piece (no broken stacks).
4. Tap in the middle of a Burmese syllable after wrapping. The caret must sit
   on the same syllable, not one code point left or right.
5. Type at the end of a line and keep typing.
   - Earlier letters must not shimmer or change shade.
   - After wrapping, tap the new line and confirm the caret still lands on the
     right syllable.
6. Undo (`Ctrl+Z` or the undo button) and make sure the caret returns to the
   same place and the drawn text still matches.
7. Switch to Monospace (`F`) if the device shapes Burmese badly, then switch
   back. Text position and wrapping must stay aligned in both modes.
8. Toggle show-through (`S`); the previous page is a faint mirrored ghost and
   never changes the caret or the live text.
9. Rotate the device / change the viewport and confirm the red margin, rules
   and textarea text stay in the same place.
