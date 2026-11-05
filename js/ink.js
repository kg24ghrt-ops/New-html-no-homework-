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
const GRAIN_SIZE = 512;
const BLOTCH_SIZE = 24;
const ASCII = /^[\x20-\x7E]*$/;

let inkCanvas = null;
let inkCtx = null;
let inkKey = null;
let grainPattern = null;

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

// Tileable paper-fibre grain plus soft density blotches. Drawn with
// destination-out it nibbles tiny holes into the ink, like real ink sitting
// on top of paper fibre instead of a flat vector fill.
function createGrainPattern(c) {
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

	const pattern = c.createPattern(tile, "repeat");
	return pattern;
}

export function inkBaselineY(lineIndex) {
	return TOP_MARGIN + (lineIndex + 1) * LINE_GAP + BASELINE_OFFSET;
}

// Broad, soft bleed under the glyph edges: what ink does when it soaks into
// paper. Drawn once per line so it stays coherent, then the crisp body covers
// the middle and leaves a faint wet halo.
function drawBleed(g, wrapped) {
	const textX = LEFT_MARGIN + TEXT_INSET;
	const rand = makeRandom(0x2f6e1b93);

	g.save();
	g.globalCompositeOperation = "source-over";
	g.shadowColor = `rgba(${INK[0]}, ${INK[1]}, ${INK[2]}, 0.55)`;
	g.shadowBlur = Math.max(1.2, MM * 0.38);
	g.globalAlpha = 0.55;
	g.fillStyle = inkColor(0.75);

	for (let lineIndex = 0; lineIndex < wrapped.length; lineIndex++) {
		const line = wrapped[lineIndex];
		const y = inkBaselineY(lineIndex) + (rand() - 0.5) * 0.5;
		g.fillText(line, textX, y);
	}
	g.restore();
}

// Exact same x advance and baseline as the original fillText layout, but each
// glyph gets its own ink load, a sub-pixel wobble and sometimes a darker
// pooled spot. Positions do not move enough to affect the caret.
function drawCharacters(g, wrapped) {
	const textX = LEFT_MARGIN + TEXT_INSET;
	const rand = makeRandom(0x51ed270b);

	for (let lineIndex = 0; lineIndex < wrapped.length; lineIndex++) {
		const line = wrapped[lineIndex];
		const y = inkBaselineY(lineIndex) + (rand() - 0.5) * 0.8;

		if (!ASCII.test(line)) {
			// Leave complex scripts to the browser's shaper; only vary density.
			const shade = 0.88 + rand() * 0.16;
			g.globalAlpha = 0.88 + rand() * 0.12;
			g.fillStyle = inkColor(shade);
			g.fillText(line, textX, y);
			continue;
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
}

function buildInkLayer(wrapped) {
	inkCtx.setTransform(1, 0, 0, 1, 0, 0);
	inkCtx.globalCompositeOperation = "source-over";
	inkCtx.globalAlpha = 1;
	inkCtx.shadowBlur = 0;
	inkCtx.clearRect(0, 0, PAPER_WIDTH, PAPER_HEIGHT);
	inkCtx.font = FONT_SIZE + "px monospace";
	inkCtx.textBaseline = "alphabetic";
	inkCtx.imageSmoothingEnabled = true;

	drawBleed(inkCtx, wrapped);
	drawCharacters(inkCtx, wrapped);

	// Paper-fibre erosion.
	if (grainPattern) {
		inkCtx.globalCompositeOperation = "destination-out";
		inkCtx.globalAlpha = 1;
		inkCtx.fillStyle = grainPattern;
		inkCtx.fillRect(0, 0, PAPER_WIDTH, PAPER_HEIGHT);
		inkCtx.globalCompositeOperation = "source-over";
	}
}

function ensureLayer() {
	if (inkCanvas) return;
	inkCanvas = document.createElement("canvas");
	inkCanvas.width = PAPER_WIDTH;
	inkCanvas.height = PAPER_HEIGHT;
	inkCtx = inkCanvas.getContext("2d");
	grainPattern = createGrainPattern(inkCtx);
}

// Draw the cached ink layer onto the page. Multiply blending lets the ink
// darken the ruled lines and paper grain underneath, like real ink.
export function drawInkText(target, wrapped) {
	const key = wrapped.join("\n");
	ensureLayer();
	if (key !== inkKey) {
		inkKey = key;
		buildInkLayer(wrapped);
	}

	const prevComposite = target.globalCompositeOperation;
	const prevSmoothing = target.imageSmoothingQuality;
	target.globalCompositeOperation = "multiply";
	target.imageSmoothingQuality = "high";
	target.drawImage(inkCanvas, 0, 0);
	target.globalCompositeOperation = prevComposite;
	target.imageSmoothingQuality = prevSmoothing;
}
