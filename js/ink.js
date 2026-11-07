import { fontSpec } from "./fonts.js";
import { graphemeOffsets, scriptRuns } from "./text.js";
import {
	FONT_SIZE,
	LEFT_MARGIN,
	LINE_GAP,
	MM,
	PAPER_HEIGHT,
	PAPER_WIDTH,
	RIGHT_MARGIN,
	TOP_MARGIN,
	TEXT_INSET,
} from "./paper.js";

// Dark blue-black fountain-pen ink. Kept close to the original text tone so
// contrast and readability stay the same.
const INK = [28, 38, 58];
const BASELINE_OFFSET = -1.5 * MM;
const LINE_BASELINE = LINE_GAP + BASELINE_OFFSET;
const GRAIN_SIZE = 512;
const BLOTCH_SIZE = 24;
const MAX_LINE_CACHE = 300;
// Myanmar stacked marks are taller than Latin. Give every cached line 3mm of
// vertical breathing room above and below the 7mm ruled row; rows overlap a
// little and are composited with multiply on the page.
const LINE_PAD = 3 * MM;
const LINE_SIDE_PAD = 2 * MM;
const LINE_CANVAS_HEIGHT = LINE_GAP + LINE_PAD * 2;
const CONTENT_BASELINE = LINE_PAD + LINE_BASELINE;
const DEG = Math.PI / 180;
const MAX_LINE_X_MM = (PAPER_WIDTH - RIGHT_MARGIN - (LEFT_MARGIN + TEXT_INSET)) / MM;

// Every realism offset is capped here and is visual only. None of these
// values feeds back into the advance of the next glyph.
export const INK_LIMITS = Object.freeze({
	glyphDx: 0.1 * MM,
	glyphSize: 0.03,
	glyphRotation: 2 * DEG,
	glyphSlant: 0.02,
	wordDx: 0.4 * MM,
	baselineWander: 0.6 * MM,
	myanmarRotation: 0.3 * DEG,
	lineRotation: 0.15 * DEG,
	lineWobble: 0.4 * MM,
});

const lineCache = new Map();
const inkPages = new Map();
let grainTile = null;

export function clearInkLineCache() {
	lineCache.clear();
}

function inkColor(shade = 1, rgb = INK) {
	return `rgb(${Math.round(rgb[0] * shade)}, ${Math.round(rgb[1] * shade)}, ${Math.round(rgb[2] * shade)})`;
}

// Small deterministic PRNG so the ink texture is stable between redraws.
function makeRandom(seed) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Stable seed for one glyph, run or word. It deliberately depends on the
// page, the absolute source offset and the character - never on the whole
// line. Typing at the end of a line therefore cannot restyle earlier ink.
export function hashSeed(pageId, offset, text) {
	let h = 2166136261;
	const source = `${pageId}\u0000${offset}\u0000${text}`;
	for (let i = 0; i < source.length; i++) {
		h ^= source.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

function wordSeed(pageId, wordStart) {
	return hashSeed(pageId, wordStart, "\u0000word");
}

// Per-glyph visual jitter. The caller keeps the real advance from cumulative
// measureText widths; these numbers only move the glyph on screen.
export function glyphJitter(pageId, offset, ch) {
	const rand = makeRandom(hashSeed(pageId, offset, ch));
	return {
		dx: (rand() - 0.5) * 2 * INK_LIMITS.glyphDx,
		scale: 1 + (rand() - 0.5) * 2 * INK_LIMITS.glyphSize,
		rotation: (rand() - 0.5) * 2 * INK_LIMITS.glyphRotation,
		slant: (rand() - 0.5) * 2 * INK_LIMITS.glyphSlant,
		pressure: rand(),
		blob: rand() > 0.9,
	};
}

// Per-word visual offset and shade. Seeded from the word's first source
// character, so appending to the end of a word never changes earlier ink.
export function wordJitter(pageId, wordStart) {
	const rand = makeRandom(wordSeed(pageId, wordStart));
	return {
		dx: (rand() - 0.5) * 2 * INK_LIMITS.wordDx,
		shade: 0.88 + rand() * 0.12,
		rotation: (rand() - 0.5) * 2 * INK_LIMITS.myanmarRotation,
	};
}

// Low-frequency baseline wander: two slow sines plus a little noise, faded to
// zero at the right edge of the widest line. It is a function of distance from
// the line start only, so earlier glyphs never move when text is appended.
export function baselineWander(lineSeed, xMm) {
	const rand = makeRandom(lineSeed ^ 0x9e3779b9);
	const p1 = rand() * Math.PI * 2;
	const p2 = rand() * Math.PI * 2;
	const p3 = rand() * Math.PI * 2;
	const raw =
		0.60 * Math.sin(xMm * 0.075 + p1) +
		0.32 * Math.sin(xMm * 0.19 + p2) +
		0.08 * Math.sin(xMm * 0.9 + p3);
	const fade = xMm <= 130 ? 1 : Math.max(0, (MAX_LINE_X_MM - xMm) / (MAX_LINE_X_MM - 130));
	return raw * INK_LIMITS.baselineWander * fade;
}

// Tileable paper-fibre grain plus soft density blotches. Drawn with
// destination-out it nibbles tiny holes into the ink, like real ink sitting
// on top of paper fibre instead of a flat vector fill.
function ensureGrain() {
	if (grainTile) return;
	const tile = document.createElement("canvas");
	tile.width = GRAIN_SIZE;
	tile.height = GRAIN_SIZE;
	const g = tile.getContext("2d");
	const rand = makeRandom(0x1a2b3c4d);

	const img = g.createImageData(GRAIN_SIZE, GRAIN_SIZE);
	const data = img.data;
	for (let i = 0; i < data.length; i += 4) {
		data[i] = INK[0];
		data[i + 1] = INK[1];
		data[i + 2] = INK[2];
		const n = rand();
		// Sparse, stronger nibbles read as fibre at normal zoom.
		data[i + 3] = n > 0.62 ? Math.round((n - 0.62) * 92) : 0;
	}
	g.putImageData(img, 0, 0);

	const blotch = document.createElement("canvas");
	blotch.width = BLOTCH_SIZE;
	blotch.height = BLOTCH_SIZE;
	const b = blotch.getContext("2d");
	const bimg = b.createImageData(BLOTCH_SIZE, BLOTCH_SIZE);
	for (let i = 0; i < bimg.data.length; i += 4) {
		bimg.data[i] = INK[0];
		bimg.data[i + 1] = INK[1];
		bimg.data[i + 2] = INK[2];
		bimg.data[i + 3] = Math.round(rand() * 46);
	}
	b.putImageData(bimg, 0, 0);

	g.imageSmoothingEnabled = true;
	g.globalAlpha = 0.55;
	g.drawImage(blotch, 0, 0, GRAIN_SIZE, GRAIN_SIZE);
	grainTile = tile;
}

export function inkBaselineY(lineIndex) {
	return TOP_MARGIN + (lineIndex + 1) * LINE_GAP + BASELINE_OFFSET;
}

// Broad, soft bleed under the glyph edges: what ink does when it soaks into
// paper. Drawn once per line so it stays coherent, then the crisp body covers
// the middle and leaves a faint wet halo.
function drawBleed(g, line, baseline, seed, textX = LEFT_MARGIN + TEXT_INSET) {
	const rand = makeRandom(seed ^ 0x2f6e1b93);
	g.save();
	g.globalCompositeOperation = "source-over";
	g.shadowColor = `rgba(${INK[0]}, ${INK[1]}, ${INK[2]}, 0.55)`;
	g.shadowBlur = Math.max(1.2, MM * 0.38);
	g.globalAlpha = 0.55;
	g.fillStyle = inkColor(0.75);
	g.fillText(line, textX, baseline + (rand() - 0.5) * 0.5);
	g.restore();
}

// Exact same x advance and baseline as a plain fillText of the whole line, but
// split into script runs. Myanmar is always one fillText per run so the
// browser shaper can stack and reorder marks; Latin is drawn per grapheme
// cluster using cumulative prefix widths for its advance.
export function drawCharacters(g, line, baseline, options = {}) {
	const pageId = options.pageId ?? "page";
	const start = options.start ?? 0;
	const lineSeed = hashSeed(pageId, start, "\u0000line");
	const textX = options.textX ?? (LEFT_MARGIN + TEXT_INSET);
	if (line === "") return;

	for (const run of scriptRuns(line)) {
		const runX = textX + g.measureText(line.slice(0, run.start)).width;
		const runStart = start + run.start;

		if (run.script === "myanmar") {
			// One call for the whole run: stacked consonants, medials and
			// reordered vowels stay intact. Realism is run-level only.
			const runRand = makeRandom(hashSeed(pageId, runStart, run.text));
			const shade = 0.88 + runRand() * 0.12;
			const alpha = 0.88 + runRand() * 0.1;
			const rotation = (runRand() - 0.5) * 2 * INK_LIMITS.myanmarRotation;
			const runWidth = g.measureText(run.text).width;
			const xMm = (runX - textX + runWidth / 2) / MM;
			const wander = baselineWander(lineSeed, xMm);

			g.save();
			g.translate(runX, baseline + wander);
			g.rotate(rotation);
			g.globalAlpha = alpha;
			g.fillStyle = inkColor(shade);
			g.fillText(run.text, 0, 0);
			g.restore();
			continue;
		}

		let wordStart = 0;
		let wordGlyph = 0;
		let afterSpace = true;
		for (const cluster of graphemeOffsets(run.text)) {
			const ch = cluster.segment;
			if (ch.trim() === "") {
				afterSpace = true;
				continue;
			}
			if (afterSpace) {
				wordStart = cluster.offset;
				wordGlyph = 0;
				afterSpace = false;
			}

			const absolute = runStart + cluster.offset;
			const jitter = glyphJitter(pageId, absolute, ch);
			const word = wordJitter(pageId, runStart + wordStart);
			const prefix = line.slice(0, run.start + cluster.offset);
			const prefixWidth = g.measureText(prefix).width;
			const wander = baselineWander(lineSeed, prefixWidth / MM);

			// Ink is loaded at the start of a word and thins slightly towards
			// its end. This depends on distance from the word start, not word
			// length, so appending never changes earlier glyphs.
			const fade = Math.min(0.16, wordGlyph * 0.02);
			const shade = word.shade
				* (1.02 - fade * 0.5)
				* (0.97 + jitter.pressure * 0.06)
				* (jitter.blob ? 0.94 : 1);
			const alpha = Math.max(
				0.8,
				Math.min(1, 0.98 - fade + (jitter.pressure - 0.5) * 0.03),
			);

			g.save();
			g.translate(prefixWidth + textX + word.dx + jitter.dx, baseline + wander);
			g.rotate(jitter.rotation);
			g.transform(1, 0, jitter.slant, 1, 0, 0);
			g.scale(jitter.scale, jitter.scale);
			g.globalAlpha = alpha;
			g.fillStyle = inkColor(shade);
			g.fillText(ch, 0, 0);
			g.restore();
			wordGlyph++;
		}
	}
}

function getLineCanvas(text, quality, options = {}) {
	if (text === "") return null;
	const fontMode = options.fontMode ?? "monospace";
	const pageId = options.pageId ?? "page";
	const start = options.start ?? 0;
	const key = [quality, fontMode, pageId, start, text].join("\u0000");
	const cached = lineCache.get(key);
	if (cached) return cached;

	const scratch = document.createElement("canvas").getContext("2d");
	scratch.font = fontSpec(fontMode, FONT_SIZE);
	const textWidth = scratch.measureText(text).width;
	const cssWidth = textWidth + LINE_SIDE_PAD * 2;

	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(cssWidth * quality));
	canvas.height = Math.max(1, Math.round(LINE_CANVAS_HEIGHT * quality));
	const g = canvas.getContext("2d");
	g.scale(quality, quality);
	g.font = fontSpec(fontMode, FONT_SIZE);
	g.textBaseline = "alphabetic";
	g.imageSmoothingEnabled = true;

	const lineRand = makeRandom(hashSeed(pageId, start, "\u0000line"));
	const lineAngle = (lineRand() - 0.5) * 2 * INK_LIMITS.lineRotation;
	const lineWobble = (lineRand() - 0.5) * 2 * INK_LIMITS.lineWobble;
	const textX = LINE_SIDE_PAD;

	// Whole-line realism: one tiny rotation plus a left-edge wobble. The
	// baseline stays where the textarea expects it.
	g.save();
	g.translate(textX + lineWobble, CONTENT_BASELINE);
	g.rotate(lineAngle);
	g.translate(-textX, -CONTENT_BASELINE);
	drawBleed(g, text, CONTENT_BASELINE, hashSeed(pageId, start, "\u0000bleed"), textX);
	drawCharacters(g, text, CONTENT_BASELINE, { pageId, start, textX });
	g.restore();

	ensureGrain();
	const pattern = g.createPattern(grainTile, "repeat");
	if (pattern) {
		g.globalCompositeOperation = "destination-out";
		g.globalAlpha = 1;
		g.fillStyle = pattern;
		g.fillRect(0, 0, cssWidth, LINE_CANVAS_HEIGHT);
		g.globalCompositeOperation = "source-over";
	}

	if (lineCache.size >= MAX_LINE_CACHE) lineCache.delete(lineCache.keys().next().value);
	lineCache.set(key, canvas);
	return canvas;
}

function getPage(quality) {
	let page = inkPages.get(quality);
	if (page) return page;

	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(PAPER_WIDTH * quality));
	canvas.height = Math.max(1, Math.round(PAPER_HEIGHT * quality));
	page = { canvas, ctx: canvas.getContext("2d"), keys: [] };
	inkPages.set(quality, page);
	return page;
}

// Returns a transparent page-sized ink layer. The page itself is composited
// again on every change (cheap drawImage calls), while each line raster is
// reused from lineCache until its text, source offset or font changes.
export function getInkPage(wrapped, quality = 1, options = {}) {
	const opts = typeof options === "string" ? { fontMode: options } : options;
	const fontMode = opts.fontMode ?? "monospace";
	const pageId = opts.pageId ?? "page";
	const page = getPage(quality);
	const ctx = page.ctx;
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.globalCompositeOperation = "source-over";
	ctx.globalAlpha = 1;
	ctx.clearRect(0, 0, page.canvas.width, page.canvas.height);

	const lines = wrapped.map((line) => (typeof line === "string" ? { text: line, start: 0 } : line));
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line.text) continue;
		const lineCanvas = getLineCanvas(line.text, quality, {
			fontMode,
			pageId,
			start: line.start,
		});
		if (!lineCanvas) continue;
		const rowX = Math.round((LEFT_MARGIN + TEXT_INSET - LINE_SIDE_PAD) * quality);
		const rowY = Math.round((TOP_MARGIN + i * LINE_GAP - LINE_PAD) * quality);
		ctx.drawImage(lineCanvas, rowX, rowY);
	}

	// Optional ghost of the previous page, mirrored and very faint. It is a
	// separate layer so it can never affect the live text or the caret.
	if (opts.showThrough && Array.isArray(opts.previousLines)) {
		const previousId = opts.previousPageId ?? `${pageId}-previous`;
		ctx.save();
		ctx.globalAlpha = 0.04;
		ctx.translate(page.canvas.width, 0);
		ctx.scale(-1, 1);
		for (let i = 0; i < opts.previousLines.length; i++) {
			const line = opts.previousLines[i];
			if (!line.text) continue;
			const lineCanvas = getLineCanvas(line.text, quality, {
				fontMode,
				pageId: previousId,
				start: line.start,
			});
			if (!lineCanvas) continue;
			const rowX = Math.round((LEFT_MARGIN + TEXT_INSET - LINE_SIDE_PAD) * quality);
			const rowY = Math.round((TOP_MARGIN + i * LINE_GAP - LINE_PAD) * quality);
			ctx.drawImage(lineCanvas, page.canvas.width - rowX - lineCanvas.width, rowY);
		}
		ctx.restore();
	}
	ctx.globalCompositeOperation = "source-over";
	ctx.globalAlpha = 1;
	return page.canvas;
}

export function releaseInkPage(quality = 1) {
	inkPages.delete(quality);
}
