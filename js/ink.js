import { fontSpec } from "./fonts.js";
import {
	FONT_SIZE,
	LEFT_MARGIN,
	LINE_GAP,
	MM,
	PAPER_HEIGHT,
	PAPER_WIDTH,
	TOP_MARGIN,
	TEXT_INSET,
} from "./paper.js";

// Dark blue-black fountain-pen ink. Kept close to the original text tone so
// contrast and readability stay the same.
const INK = [28, 38, 58];
const INK_DARK = [12, 18, 34];
const BASELINE_OFFSET = -1.5 * MM;
const LINE_BASELINE = LINE_GAP + BASELINE_OFFSET;
const GRAIN_SIZE = 512;
const BLOTCH_SIZE = 24;
const MAX_LINE_CACHE = 300;
const ASCII = /^[\x20-\x7E]*$/;

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

function hashLine(text) {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
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
function drawBleed(g, line, baseline, seed) {
	const rand = makeRandom(seed ^ 0x2f6e1b93);
	g.save();
	g.globalCompositeOperation = "source-over";
	g.shadowColor = `rgba(${INK[0]}, ${INK[1]}, ${INK[2]}, 0.55)`;
	g.shadowBlur = Math.max(1.2, MM * 0.38);
	g.globalAlpha = 0.55;
	g.fillStyle = inkColor(0.75);
	g.fillText(line, LEFT_MARGIN + TEXT_INSET, baseline + (rand() - 0.5) * 0.5);
	g.restore();
}

// Exact same x advance and baseline as the original fillText layout, but each
// glyph gets its own ink load, a sub-pixel wobble and sometimes a darker
// pooled spot. Positions do not move enough to affect the caret.
function drawCharacters(g, line, baseline, seed) {
	const rand = makeRandom(seed ^ 0x51ed270b);
	const textX = LEFT_MARGIN + TEXT_INSET;
	const y = baseline + (rand() - 0.5) * 0.8;

	if (!ASCII.test(line)) {
		// Leave complex scripts to the browser's shaper; only vary density.
		const shade = 0.88 + rand() * 0.16;
		g.globalAlpha = 0.88 + rand() * 0.12;
		g.fillStyle = inkColor(shade);
		g.fillText(line, textX, y);
		return;
	}

	let x = textX;
	for (let charIndex = 0; charIndex < line.length; charIndex++) {
		const ch = line[charIndex];
		const width = g.measureText(ch).width;
		if (ch !== " ") {
			const shade = (1 - 0.08 * (charIndex / Math.max(1, line.length))) * (0.86 + rand() * 0.16);
			const alpha = 0.82 + rand() * 0.18;
			const dx = (rand() - 0.5) * 0.6;
			const dy = (rand() - 0.5) * 0.9;

			g.globalAlpha = alpha;
			g.fillStyle = inkColor(shade);
			g.fillText(ch, x + dx, y + dy);

			// A few glyphs carry a darker blob where the pen slowed down.
			if (rand() > 0.9) {
				g.globalAlpha = 0.35 + rand() * 0.25;
				g.fillStyle = inkColor(0.65, INK_DARK);
				g.fillText(ch, x + dx, y + dy);
			}
		}
		x += width;
	}
}

function getLineCanvas(text, quality, fontMode) {
	if (text === "") return null;
	const key = quality + "\u0000" + fontMode + "\u0000" + text;
	const cached = lineCache.get(key);
	if (cached) return cached;

	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(PAPER_WIDTH * quality));
	canvas.height = Math.max(1, Math.round(LINE_GAP * quality));
	const g = canvas.getContext("2d");
	g.scale(quality, quality);
	g.font = fontSpec(fontMode, FONT_SIZE);
	g.textBaseline = "alphabetic";
	g.imageSmoothingEnabled = true;

	const seed = hashLine(text);
	drawBleed(g, text, LINE_BASELINE, seed);
	drawCharacters(g, text, LINE_BASELINE, seed);

	ensureGrain();
	const pattern = g.createPattern(grainTile, "repeat");
	if (pattern) {
		g.globalCompositeOperation = "destination-out";
		g.globalAlpha = 1;
		g.fillStyle = pattern;
		g.fillRect(0, 0, PAPER_WIDTH, LINE_GAP);
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

// Returns a transparent page-sized ink layer. Only rows whose line text
// changed are rasterized again; unchanged lines are reused from lineCache.
export function getInkPage(wrapped, quality = 1, fontMode = "monospace") {
	const page = getPage(quality);
	const ctx = page.ctx;
	ctx.globalCompositeOperation = "source-over";
	ctx.globalAlpha = 1;

	const lineH = Math.max(1, Math.round(LINE_GAP * quality));
	const max = Math.max(page.keys.length, wrapped.length);
	for (let i = 0; i < max; i++) {
		const text = i < wrapped.length ? wrapped[i] : null;
		if (page.keys[i] === text) continue;

		const rowY = Math.round((TOP_MARGIN + i * LINE_GAP) * quality);
		ctx.clearRect(0, rowY, page.canvas.width, lineH);
		if (text) {
			const lineCanvas = getLineCanvas(text, quality, fontMode);
			if (lineCanvas) ctx.drawImage(lineCanvas, 0, rowY);
		}
		page.keys[i] = text;
	}
	page.keys.length = wrapped.length;
	return page.canvas;
}

export function releaseInkPage(quality = 1) {
	inkPages.delete(quality);
}
